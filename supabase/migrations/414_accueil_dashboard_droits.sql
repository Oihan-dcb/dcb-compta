-- 414 — Accueil PowerHouse v3 (14/10/2026) : droits par compte, disposition par utilisateur,
-- ticket depuis un signalement.
--
-- 1. ph_droit : droits explicites PAR COMPTE (auth.users), administrables par Oïhan (droit « admin »).
--    Le rôle PowerHouse (auth_user_powerhouse_role) ne distingue pas Oïhan / Laura / Clémence : la tuile
--    « Performances du mois vs N-1 » (et le futur onglet Metrics) repose donc sur un droit explicite.
--      droit 'perf'        périmètre : 'tout' | 'agence:dcb' | 'agence:lauian' | 'scope' (biens du compte)
--      droit 'honoraires'  voir les honoraires DCB (HON + FMEN + COM) dans les performances
--      droit 'admin'       gérer ces droits (écran Personnaliser › Droits)
--    Pas de ligne = pas de droit (Clémence et les futurs membres du bureau : rien).
--    Une même personne peut avoir deux comptes (email pro + fiche AE) : chaque compte porte ses lignes.
-- 2. ph_mes_droits() : ce que le compte connecté peut voir (rôle, bureau, zones, perf, honoraires, admin).
-- 3. ph_dashboard_perf(mois) : chiffres du mois vs même mois N-1, calculés CÔTÉ BASE sur le périmètre du
--    droit (jamais filtrés dans le navigateur) ; honoraires seulement avec le droit 'honoraires'.
-- 4. ph_accueil_disposition : ordre / tuiles / actions rapides de l'Accueil, une ligne par compte, RLS
--    « chacun ne voit que la sienne ».
-- 5. tech_issues.signalement_id : ticket créé depuis un signalement (lien retour). Le trigger
--    trg_terrain_msg_tech ne poste rien tant que mission_id est nul : on ne recopie PAS la mission du
--    signalement dans le ticket.

-- ─── 1. Droits ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ph_droit (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  droit        text not null check (droit in ('perf', 'honoraires', 'admin')),
  perimetre    text not null default 'tout'
               check (perimetre in ('tout', 'scope') or perimetre ~ '^agence:(dcb|lauian)$'),
  accorde_par  uuid,
  accorde_le   timestamptz not null default now(),
  primary key (auth_user_id, droit)
);
comment on table public.ph_droit is 'Droits PowerHouse explicites par compte (414) : perf (périmètre), honoraires, admin. Administré par les comptes admin.';

create or replace function public.ph_est_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'admin');
$$;

alter table public.ph_droit enable row level security;
drop policy if exists ph_droit_lecture on public.ph_droit;
create policy ph_droit_lecture on public.ph_droit for select to authenticated
  using (auth_user_id = auth.uid() or ph_est_admin());
-- Écriture uniquement via ph_droit_definir (security definer, contrôle admin) : aucune policy d'écriture.

create or replace function public.ph_mes_droits()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'role', auth_user_powerhouse_role(),
    'bureau', auth_user_is_bureau(),
    'zones', to_jsonb(my_secteurs()),
    'admin', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'admin'),
    'perf', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf'),
    'honoraires', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires')
  );
$$;

-- Admin : liste des comptes PowerHouse et de leurs droits
create or replace function public.ph_equipe_droits()
returns table (auth_user_id uuid, email text, prenom text, origine text, droits jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not ph_est_admin() then raise exception 'acces_refuse'; end if;
  return query
  with comptes as (
    select s.auth_user_id as uid, s.email::text as email, null::text as prenom, 'compte bureau'::text as origine
      from staff_users s where s.auth_user_id is not null
    union all
    select a.ae_user_id, a.email, nullif(trim(a.prenom), ''),
           case when a.acces_powerhouse then 'accès limité (biens du secteur)' else 'fiche ' || a.type end
      from auto_entrepreneur a
     where a.actif and a.ae_user_id is not null
       and (a.type in ('gerant', 'assistante') or a.acces_admin or a.acces_powerhouse)
  )
  select c.uid, c.email, c.prenom, c.origine,
         coalesce((select jsonb_object_agg(d.droit, d.perimetre) from ph_droit d where d.auth_user_id = c.uid), '{}'::jsonb)
    from comptes c
   order by coalesce(c.prenom, c.email);
end $$;

-- Admin : accorder / retirer un droit (p_perimetre null ou p_actif false = retirer)
create or replace function public.ph_droit_definir(p_uid uuid, p_droit text, p_actif boolean, p_perimetre text default 'tout')
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ph_est_admin() then raise exception 'acces_refuse'; end if;
  if p_droit not in ('perf', 'honoraires', 'admin') then raise exception 'droit_inconnu'; end if;
  -- Garde-fou : on ne retire pas le dernier admin
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

revoke all on function public.ph_droit_definir(uuid, text, boolean, text) from public, anon;
revoke all on function public.ph_equipe_droits() from public, anon;
grant execute on function public.ph_droit_definir(uuid, text, boolean, text) to authenticated;
grant execute on function public.ph_equipe_droits() to authenticated;
grant execute on function public.ph_mes_droits() to authenticated;
grant execute on function public.ph_est_admin() to authenticated;

-- Droits initiaux (décisions d'Oïhan, 14/10/2026)
--   Oïhan (2 comptes) : admin + performances toutes agences + honoraires
--   Laura (2 comptes) : performances Lauïan uniquement + honoraires (HON/COM de Lauïan)
--   Léa               : performances de ses biens (+ honoraires, comme la maquette v3 validée)
--   Clémence          : rien
insert into public.ph_droit (auth_user_id, droit, perimetre)
select v.uid, v.droit, v.perimetre
  from (values
    ('414218dc-b91b-454e-a0f2-9b4a3a0c5676'::uuid, 'admin', 'tout'),
    ('414218dc-b91b-454e-a0f2-9b4a3a0c5676'::uuid, 'perf', 'tout'),
    ('414218dc-b91b-454e-a0f2-9b4a3a0c5676'::uuid, 'honoraires', 'tout'),
    ('62753152-5321-40ce-ac86-36a54c2de2aa'::uuid, 'admin', 'tout'),
    ('62753152-5321-40ce-ac86-36a54c2de2aa'::uuid, 'perf', 'tout'),
    ('62753152-5321-40ce-ac86-36a54c2de2aa'::uuid, 'honoraires', 'tout'),
    ('8cb18dc9-1366-47d2-b120-13b57a9630d5'::uuid, 'perf', 'agence:lauian'),
    ('8cb18dc9-1366-47d2-b120-13b57a9630d5'::uuid, 'honoraires', 'tout'),
    ('e19b78dc-7507-41a2-926b-d32af02f79e9'::uuid, 'perf', 'agence:lauian'),
    ('e19b78dc-7507-41a2-926b-d32af02f79e9'::uuid, 'honoraires', 'tout'),
    ('a55bd53b-eb9c-4927-b018-6a1569fddebe'::uuid, 'perf', 'scope'),
    ('a55bd53b-eb9c-4927-b018-6a1569fddebe'::uuid, 'honoraires', 'tout')
  ) as v(uid, droit, perimetre)
 where exists (select 1 from auth.users u where u.id = v.uid)
on conflict (auth_user_id, droit) do nothing;

-- ─── 3. Performances du mois vs N-1 ────────────────────────────────────────────────────────────────
-- Revenus = somme fin_revenue des réservations acceptées du mois comptable (hors séjours propriétaire).
-- Prix moyen / nuit = hébergement (fin_accommodation) / nuits de ces réservations.
-- Occupation = nuits occupées DANS le mois (chevauchement des séjours acceptés hors propriétaire) /
--   (biens saisonniers actuels du périmètre × jours du mois) — même parc pour N et N-1.
-- Net propriétaires = VIRProprio (ventilation code VIR, montant_ttc) des réservations acceptées.
-- Honoraires DCB HT = HON + FMEN + COM (montant_ht).
create or replace function public.ph_dashboard_perf(p_mois text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_per text; v_hon boolean; v_mois text; v_n1 text; v_biens uuid[]; v_parc_ids uuid[]; v_parc int; v_res jsonb := '{}'::jsonb; m text;
  d1 date; d2 date; v_jours int;
begin
  select d.perimetre into v_per from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf';
  if v_per is null then raise exception 'acces_refuse'; end if;
  v_hon := exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires');
  v_mois := coalesce(nullif(p_mois, ''), to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM'));
  if v_mois !~ '^\d{4}-\d{2}$' then raise exception 'mois_invalide'; end if;
  v_n1 := to_char((v_mois || '-01')::date - interval '1 year', 'YYYY-MM');

  select array_agg(b.id) into v_biens from bien b
   where case when v_per = 'tout' then true
              when v_per = 'scope' then b.id in (select my_scoped_bien_ids())
              when v_per like 'agence:%' then b.agence = substr(v_per, 8)
              else false end;
  v_biens := coalesce(v_biens, '{}');
  select coalesce(array_agg(b.id), '{}') into v_parc_ids from bien b where b.id = any(v_biens) and b.statut_location = 'saisonnier';
  v_parc := coalesce(array_length(v_parc_ids, 1), 0);

  foreach m in array array[v_mois, v_n1] loop
    d1 := (m || '-01')::date; d2 := (d1 + interval '1 month')::date; v_jours := d2 - d1;
    v_res := v_res || jsonb_build_object(case when m = v_mois then 'n' else 'n1' end, (
      select jsonb_build_object(
        'mois', m,
        'revenus_cts', coalesce((select sum(r.fin_revenue) from reservation r where r.bien_id = any(v_biens) and r.mois_comptable = m and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)), 0),
        'hebergement_cts', coalesce((select sum(r.fin_accommodation) from reservation r where r.bien_id = any(v_biens) and r.mois_comptable = m and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)), 0),
        'nuits_resas', coalesce((select sum(r.nights) from reservation r where r.bien_id = any(v_biens) and r.mois_comptable = m and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)), 0),
        'nb_resas', (select count(*) from reservation r where r.bien_id = any(v_biens) and r.mois_comptable = m and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)),
        'nuits_occupees', coalesce((select sum(greatest(0, least(r.departure_date, d2) - greatest(r.arrival_date, d1))) from reservation r
                                     where r.bien_id = any(v_parc_ids) and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)
                                       and r.arrival_date < d2 and r.departure_date > d1), 0),
        'jours', v_jours,
        'net_proprio_cts', coalesce((select sum(v.montant_ttc) from ventilation v join reservation r on r.id = v.reservation_id
                                      where v.bien_id = any(v_biens) and v.mois_comptable = m and v.code = 'VIR'
                                        and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)), 0),
        'honoraires_ht_cts', case when v_hon then coalesce((select sum(v.montant_ht) from ventilation v join reservation r on r.id = v.reservation_id
                                      where v.bien_id = any(v_biens) and v.mois_comptable = m and v.code in ('HON', 'FMEN', 'COM')
                                        and r.final_status = 'accepted' and not coalesce(r.owner_stay, false)), 0) end
      )));
  end loop;
  return v_res || jsonb_build_object('perimetre', v_per, 'honoraires', v_hon, 'parc', v_parc, 'nb_biens', coalesce(array_length(v_biens, 1), 0));
end $$;
revoke all on function public.ph_dashboard_perf(text) from public, anon;
grant execute on function public.ph_dashboard_perf(text) to authenticated;

-- ─── 4. Disposition de l'Accueil par compte ────────────────────────────────────────────────────────
create table if not exists public.ph_accueil_disposition (
  auth_user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tuiles       jsonb not null default '[]'::jsonb,   -- [{ "k": "aujourdhui", "on": true }, …] dans l'ordre
  actions      jsonb not null default '[]'::jsonb,   -- ["mission", "ticket", …]
  maj_le       timestamptz not null default now()
);
comment on table public.ph_accueil_disposition is 'Accueil PowerHouse v3 (414) : disposition propre à chaque compte (RLS : chacun ne voit que la sienne).';
alter table public.ph_accueil_disposition enable row level security;
drop policy if exists ph_accueil_dispo_select on public.ph_accueil_disposition;
drop policy if exists ph_accueil_dispo_insert on public.ph_accueil_disposition;
drop policy if exists ph_accueil_dispo_update on public.ph_accueil_disposition;
create policy ph_accueil_dispo_select on public.ph_accueil_disposition for select to authenticated using (auth_user_id = auth.uid());
create policy ph_accueil_dispo_insert on public.ph_accueil_disposition for insert to authenticated with check (auth_user_id = auth.uid() and auth_user_is_staff());
create policy ph_accueil_dispo_update on public.ph_accueil_disposition for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- ─── 5. Ticket technique créé depuis un signalement ────────────────────────────────────────────────
alter table public.tech_issues add column if not exists signalement_id uuid references public.signalements(id) on delete set null;
create index if not exists tech_issues_signalement_idx on public.tech_issues (signalement_id) where signalement_id is not null;
comment on column public.tech_issues.signalement_id is 'Signalement d''origine (ticket créé depuis le signalement, Accueil v3 414) — lien retour.';
