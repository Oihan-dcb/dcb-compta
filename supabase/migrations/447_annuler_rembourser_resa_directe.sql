-- 447 — « Annuler et rembourser » une réservation directe payée en ligne (PowerHouse, 16/10/2026).
--
-- 1. Droit explicite ph_droit 'rembourser' (périmètre 'tout' | 'agence:dcb' | 'agence:lauian') : seuls Oïhan (toutes
--    agences) et Laura (Lauïan) peuvent annuler / rembourser. Administrable dans Accueil › Droits des comptes.
-- 2. resa_annulation : UNE ligne par réservation annulée par le bouton — paramètres figés à la confirmation (mode,
--    montant, motif), journal des étapes (reprise possible si une étape échoue, sans jamais rembourser deux fois),
--    remboursements Stripe par PaymentIntent. Écrite par le serveur (service role) uniquement ; lecture staff.
-- 3. devis_option : annulation_id / annule_le / rembourse_centimes → statut « Annulée — remboursée X € le … » dans
--    Vente directe › Demandes & devis (le devis garde statut « converti » : les statistiques de conversion ne bougent pas).
-- 4. dispo_action_log : action 'resa_annuler_rembourser'.
-- 5. Compta : une résa annulée par le bouton garde le montant CONSERVÉ comme revenu (fin_revenue), même quand la synchro
--    Hospitable ou le webhook réécrit la ligne (Hospitable laisse le prix total d'une résa manuelle annulée, la synchro
--    met 0 faute de paiement Hospitable). Remboursement total → 0 → aucune ligne de ventilation (règle du 25/09/2026).

-- ─── 1. Droit « rembourser » ──────────────────────────────────────────────────────────────────────────────
alter table public.ph_droit drop constraint if exists ph_droit_droit_check;
alter table public.ph_droit add constraint ph_droit_droit_check check (droit in ('perf', 'honoraires', 'admin', 'rembourser'));

create or replace function public.ph_droit_definir(p_uid uuid, p_droit text, p_actif boolean, p_perimetre text default 'tout')
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ph_est_admin() then raise exception 'acces_refuse'; end if;
  if p_droit not in ('perf', 'honoraires', 'admin', 'rembourser') then raise exception 'droit_inconnu'; end if;
  if p_droit = 'rembourser' and coalesce(p_actif, false) and coalesce(nullif(p_perimetre, ''), 'tout') not in ('tout', 'agence:dcb', 'agence:lauian') then
    raise exception 'perimetre_invalide';
  end if;
  if p_droit = 'admin' and not coalesce(p_actif, false)
     and not exists (select 1 from ph_droit d where d.droit = 'admin' and d.auth_user_id <> p_uid) then
    raise exception 'dernier_admin';
  end if;
  if coalesce(p_actif, false) then
    insert into ph_droit (auth_user_id, droit, perimetre, accorde_par)
    values (p_uid, p_droit, coalesce(nullif(p_perimetre, ''), 'tout'), auth.uid())
    on conflict (auth_user_id, droit) do update
      set perimetre = excluded.perimetre, accorde_par = excluded.accorde_par, accorde_le = now();
  else
    delete from ph_droit where auth_user_id = p_uid and droit = p_droit;
  end if;
end $$;

create or replace function public.ph_mes_droits()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'role', auth_user_powerhouse_role(),
    'bureau', auth_user_is_bureau(),
    'zones', to_jsonb(my_secteurs()),
    'admin', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'admin'),
    'perf', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf'),
    'honoraires', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires'),
    'rembourser', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'rembourser')
  );
$$;

-- Décision d'Oïhan (16/10/2026) : Oïhan (2 comptes) toutes agences, Laura (2 comptes) Lauïan.
insert into public.ph_droit (auth_user_id, droit, perimetre)
select v.uid, 'rembourser', v.per
  from (values
    ('414218dc-b91b-454e-a0f2-9b4a3a0c5676'::uuid, 'tout'),
    ('62753152-5321-40ce-ac86-36a54c2de2aa'::uuid, 'tout'),
    ('e19b78dc-7507-41a2-926b-d32af02f79e9'::uuid, 'agence:lauian'),
    ('8cb18dc9-1366-47d2-b120-13b57a9630d5'::uuid, 'agence:lauian')
  ) as v(uid, per)
 where exists (select 1 from auth.users u where u.id = v.uid)
on conflict (auth_user_id, droit) do nothing;

-- ─── 2. Journal des annulations ───────────────────────────────────────────────────────────────────────────
create table if not exists public.resa_annulation (
  id                       uuid primary key default gen_random_uuid(),
  reservation_id           uuid not null unique references public.reservation(id) on delete restrict,
  reservation_code         text,
  resa_hospitable_id       text,
  devis_id                 uuid references public.devis_option(id) on delete set null,
  contrat_id               uuid,
  bien_id                  uuid references public.bien(id) on delete set null,
  agence                   text not null default 'dcb' check (agence in ('dcb', 'lauian')),
  mode                     text not null check (mode in ('total', 'politique', 'personnalise', 'aucun')),
  total_paye_centimes      integer not null default 0 check (total_paye_centimes >= 0),
  rembourse_centimes       integer not null default 0 check (rembourse_centimes >= 0),
  retenu_centimes          integer not null default 0 check (retenu_centimes >= 0),
  frais_bancaires_centimes integer not null default 0 check (frais_bancaires_centimes >= 0),
  calcul                   jsonb,
  motif                    text not null,
  motif_detail             text,
  prevenir_voyageur        boolean not null default false,
  message_voyageur         text,
  mail                     jsonb,
  statut                   text not null default 'en_cours' check (statut in ('en_cours', 'termine', 'partiel')),
  etapes                   jsonb not null default '{}'::jsonb,
  remboursements           jsonb not null default '[]'::jsonb,
  compta_applique          boolean not null default false,
  verrou_le                timestamptz,
  cree_par                 uuid,
  cree_par_label           text,
  cree_le                  timestamptz not null default now(),
  termine_le               timestamptz,
  maj_le                   timestamptz not null default now(),
  check (rembourse_centimes + retenu_centimes = total_paye_centimes)
);
create index if not exists resa_annulation_hosp_idx on public.resa_annulation (resa_hospitable_id);
create index if not exists resa_annulation_devis_idx on public.resa_annulation (devis_id);
comment on table public.resa_annulation is 'Annulations + remboursements de résas directes faits par le bouton PowerHouse (447) : paramètres figés, étapes, remboursements Stripe. Écriture serveur seulement.';

alter table public.resa_annulation enable row level security;
drop policy if exists resa_annulation_lecture on public.resa_annulation;
create policy resa_annulation_lecture on public.resa_annulation for select to authenticated using (auth_user_is_staff());
revoke insert, update, delete on public.resa_annulation from anon, authenticated;

-- ─── 3. Devis : statut d'annulation ───────────────────────────────────────────────────────────────────────
alter table public.devis_option add column if not exists annulation_id uuid references public.resa_annulation(id) on delete set null;
alter table public.devis_option add column if not exists annule_le timestamptz;
alter table public.devis_option add column if not exists rembourse_centimes integer;

-- ─── 4. Journal des actions ───────────────────────────────────────────────────────────────────────────────
alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action = any (array[
  'block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation', 'devis_option', 'devis_prolonger',
  'devis_annuler', 'devis_convertir', 'devis_expire', 'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler',
  'sejour_hors_refacturation', 'contrat_brouillon', 'devis_envoyer', 'devis_paiement', 'devis_paye_converti', 'devis_rembourse',
  'resa_annuler_rembourser']));

-- ─── 5. Compta : montant conservé d'une résa annulée par le bouton ────────────────────────────────────────
create or replace function public.reservation_annulation_bouton_garder()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_retenu integer;
begin
  if new.final_status is distinct from 'cancelled' or new.hospitable_id is null then return new; end if;
  select a.retenu_centimes into v_retenu from resa_annulation a
   where a.resa_hospitable_id = new.hospitable_id and a.compta_applique limit 1;
  if not found then return new; end if;
  new.fin_revenue := v_retenu;
  if v_retenu > 0 then new.ventilation_manuelle := true; end if;
  return new;
end $$;
drop trigger if exists trg_reservation_annulation_bouton on public.reservation;
create trigger trg_reservation_annulation_bouton before insert or update of final_status, fin_revenue, ventilation_manuelle on public.reservation
  for each row execute function public.reservation_annulation_bouton_garder();
