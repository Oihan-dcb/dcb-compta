-- 314 — Propositions d'entretien par les AE (05/10/2026)
-- L'AE voit sur place qu'un bien a un déshumidificateur, une hotte, un barbecue… : elle PROPOSE
-- l'entretien (catalogue entretien_type), éventuellement « fait aujourd'hui » (l'extra hors forfait
-- part alors tout de suite en attente dans Gestion, comme un entretien fait). Le BUREAU valide ou
-- refuse (RPC traiter_proposition_entretien) : valider active le plan du bien — la boucle démarre,
-- avec le passage du jour comme premier « fait » s'il existe — ; refuser ne crée aucun plan.
-- Jamais de facturation récurrente au propriétaire sans décision du bureau (cf. 311).
create table if not exists public.bien_entretien_proposition (
  id                uuid primary key default gen_random_uuid(),
  bien_id           uuid not null references public.bien(id) on delete cascade,
  entretien_type_id uuid not null references public.entretien_type(id) on delete cascade,
  propose_par_ae_id uuid references public.auto_entrepreneur(id) on delete set null,
  mission_id        uuid references public.mission_menage(id) on delete set null,
  note              text,
  photo_url         text,
  fait_le           timestamptz,           -- non null = l'AE l'a fait pendant cette mission
  prestation_id     uuid references public.prestation_hors_forfait(id) on delete set null,
  statut            text not null default 'propose' check (statut in ('propose', 'valide', 'refuse')),
  traite_par        uuid,
  traite_at         timestamptz,
  created_at        timestamptz not null default now()
);
create unique index if not exists bien_entretien_proposition_ouverte_uq
  on public.bien_entretien_proposition (bien_id, entretien_type_id) where statut = 'propose';

alter table public.bien_entretien_proposition enable row level security;
drop policy if exists bien_entretien_proposition_select on public.bien_entretien_proposition;
create policy bien_entretien_proposition_select on public.bien_entretien_proposition for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff()));
drop policy if exists bien_entretien_proposition_insert on public.bien_entretien_proposition;
create policy bien_entretien_proposition_insert on public.bien_entretien_proposition for insert to authenticated with check (
  statut = 'propose' and ((propose_par_ae_id is not null and auth_user_owns_ae(propose_par_ae_id)) or auth_user_is_bureau()));
drop policy if exists bien_entretien_proposition_update on public.bien_entretien_proposition;
create policy bien_entretien_proposition_update on public.bien_entretien_proposition for update to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());

create or replace function public.traiter_proposition_entretien(p_id uuid, p_valider boolean)
returns public.bien_entretien_proposition
language plpgsql security definer set search_path = public as $$
declare pr bien_entretien_proposition; pl bien_entretien_plan;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  select * into pr from bien_entretien_proposition where id = p_id for update;
  if not found then raise exception 'proposition_introuvable'; end if;
  if pr.statut <> 'propose' then return pr; end if;
  if p_valider then
    select * into pl from bien_entretien_plan where bien_id = pr.bien_id and entretien_type_id = pr.entretien_type_id;
    if found then
      update bien_entretien_plan set actif = true where id = pl.id returning * into pl;
    else
      insert into bien_entretien_plan (bien_id, entretien_type_id, reference_initiale)
      values (pr.bien_id, pr.entretien_type_id, case when pr.fait_le is not null then pr.fait_le::date end)
      returning * into pl;
    end if;
    -- Passage du jour = premier « fait » de la boucle (son extra existe déjà, en attente)
    if pr.fait_le is not null and not exists (select 1 from bien_entretien_fait where plan_id = pl.id and fait_le = pr.fait_le) then
      insert into bien_entretien_fait (plan_id, bien_id, mission_id, ae_id, statut, fait_le, prestation_id)
      values (pl.id, pr.bien_id, pr.mission_id, pr.propose_par_ae_id, 'fait', pr.fait_le, pr.prestation_id);
    end if;
  end if;
  update bien_entretien_proposition set statut = case when p_valider then 'valide' else 'refuse' end,
    traite_par = auth.uid(), traite_at = now() where id = p_id returning * into pr;
  return pr;
end $$;
revoke all on function public.traiter_proposition_entretien(uuid, boolean) from public, anon;
grant execute on function public.traiter_proposition_entretien(uuid, boolean) to authenticated;
