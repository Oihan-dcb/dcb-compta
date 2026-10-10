-- 384 — Hub des tâches terrain, Lot 3a : contrôle des écarts Hospitable ↔ règles (10/10/2026)
--
-- LECTURE SEULE vis-à-vis d'Hospitable et des données métier : on compare `reservation`, `hospitable_tache`
-- (miroir 380), `mission_menage`, `mission_acceptation` et les congés (staff_leave / staff_off) et on
-- remonte les écarts dans Planning › À faire (endpoint PowerHouse api/mission-hub) et, pour ce qui est
-- EN RETARD et pas déjà signalé ailleurs, dans le Point du matin (vue mission_ecart_a_signaler).
--
-- Mesuré sur les 60 derniers jours avant de l'afficher (objectif : zéro fausse alerte) — voir le rapport
-- de la session et la mémoire project_hub_taches_terrain_2026-10. Règles retenues :
--
--  1. depart_sans_menage — séjour voyageur payant (accepted, pas owner_stay) dont le départ n'a aucun
--     ménage prévu : ni mission (checkout/cleaning/recouche/autre, rattachée à la résa ou datée dans la
--     fenêtre), ni tâche Hospitable (ménage/recouche/sortie/maintenance). Fenêtre de couverture :
--       • du jour du départ jusqu'à l'arrivée suivante (au moins J+2) ;
--       • « ménage fondu » : si le séjour suivant commence le jour même ET est un séjour propriétaire ou
--         une prolongation (même voyageur / « prolong »), le ménage du départ suivant couvre les deux ;
--       • sans arrivée suivante connue : jusqu'à J+7.
--     Exclus : sans_menage_motif (soupape existante, 338), menage_proprio_annule, location étudiante
--     (resa_est_etudiant), bien hors saisonnier (statut_location lld / hors_location, donc muted inclus),
--     bien encore muted.
--  2. menage_sans_sejour — ménage (mission ou tâche) qu'AUCUN séjour ne justifie (pas de séjour accepté,
--     propriétaire compris, en cours ou terminé dans les 14 jours) ET dont la résa d'origine est annulée
--     (résa de la tâche Hospitable ou de la mission). Sans résa annulée (ex. ménages VIKY du 14 et du
--     31/10 rattachés par Hospitable à un séjour terminé le 23/09), c'est ambigu → pas affiché.
--  3. ae_conge — AE en congé (staff_leave non récurrent, exceptions respectées) ou jour off (staff_off, la
--     demi-journée compte si l'heure de la mission tombe dedans) avec une mission ou une tâche Hospitable.
--     PAS les jours de repos récurrents (un AE a le droit d'accepter sur ses repos, règle Oïhan 10/10) :
--     un staff_off qui tombe sur un jour de repos récurrent de l'AE est ignoré (Xane : 53 « off » saisis
--     d'un coup le 29/04 sur ses jeudis/dimanches = 29 fausses alertes sur 60 jours sans ce filtre).
--  4. refus_toujours_assigne — mission refusée dans « Mes missions » dont la tâche Hospitable est encore
--     assignée à ce même AE (lue par le miroir au moins 20 min après le refus / la tentative de retrait).
--
-- Échéances (proposition §6) : à régler au plus tard J-2 18:00 (heure de Paris) ; dernière minute (cause
-- apparue après, ex. résa prise ou congé posé après J-2 18:00) : 2 h après. en_retard = échéance passée.
-- « C'est normal » : mission_journal type 'ecart_ignore' + ecart_cle → l'écart ne remonte plus.
--
-- B. Extra LINGE 15 € PANORAMA du 26/03/2026 (Kathy) : statut « regle_hors_circuit » (déjà payé hors
--    circuit) sans toucher au mois de mars clôturé : aucun champ figé par check_cloture_bien_fige
--    (montant, durée, imputation, mois, bien) n'est modifié, aucune écriture comptable. Le statut n'est
--    lu comme « payable » par aucun moteur (tous filtrent statut = 'valide') ; il sort des listes
--    « en attente ». Geste journalisé dans mission_journal (type 'extra_regle_hors_circuit').

-- ── 1. Journal : clé d'écart, extra concerné, nouveaux types ────────────────
alter table public.mission_journal add column if not exists ecart_cle text;
alter table public.mission_journal add column if not exists prestation_id uuid references public.prestation_hors_forfait(id) on delete set null;
create index if not exists mission_journal_ecart_idx on public.mission_journal (ecart_cle) where ecart_cle is not null;
alter table public.mission_journal drop constraint if exists mission_journal_type_check;
alter table public.mission_journal add constraint mission_journal_type_check check (type in (
  'verification', 'relance', 'reattribution', 'boucle_fait', 'boucle_non_faite', 'note', 'reglage',
  'ecart_ignore', 'extra_regle_hors_circuit'));

-- ── 2. Slug staff (= toStaffId() de PowerHouse : clé de staff_leave / staff_off) ──
create or replace function public.staff_slug(p_prenom text) returns text
language sql stable set search_path = public, extensions as $$
  select regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(p_prenom, ''))), '[^a-z0-9]+', '_', 'g'), '^_|_$', '', 'g')
$$;

-- Échéance « à régler au plus tard J-2 18:00 », ou 2 h après une cause apparue plus tard
create or replace function public.hub_echeance(p_date date, p_cause_le timestamptz) returns timestamptz
language sql stable as $$
  select case when p_cause_le is not null and p_cause_le + interval '2 hours' > ((p_date - 2) + time '18:00') at time zone 'Europe/Paris'
              then p_cause_le + interval '2 hours'
              else ((p_date - 2) + time '18:00') at time zone 'Europe/Paris' end
$$;

-- ── 3. Les écarts sur une période (fonction : sert aussi à mesurer le passé) ──
create or replace function public.mission_ecarts(p_du date, p_au date)
returns table (
  genre text, cle text, groupe text, bien_id uuid, bien_code text, bien_nom text, agence text, secteur text,
  date_ref date, heure time, mission_id uuid, task_id text, reservation_id uuid, reservation_code text,
  ae_id uuid, ae_prenom text, echeance timestamptz, en_retard boolean, pourquoi text
)
language sql stable set search_path = public, extensions as $$
with
-- missions et tâches « vivantes » de la période (une tâche n'est comptée que si aucune mission ne la porte)
mis as (
  select m.id as mission_id, case when m.ical_uid ~* '@smartbnb\.io$' then split_part(m.ical_uid, '@', 1) end as task_id,
         m.bien_id, m.ae_id, m.date_mission as d, m.heure_mission as h, m.type_mission, m.reservation_id, m.created_at
  from mission_menage m
  where m.date_mission between p_du - 3 and p_au + 25 and coalesce(m.statut, '') not in ('cancelled', 'refuse', 'annule')
),
tac as (
  select h.task_id, h.bien_id, h.ae_id, (h.debut at time zone 'Europe/Paris')::date as d, (h.debut at time zone 'Europe/Paris')::time as h,
         h.type_ph, h.reservation_code, h.assignment_status, h.teammate_nom, h.vu_le, h.created_at
  from hospitable_tache h
  where h.disparu_le is null and coalesce(h.assignment_status, '') <> 'cancelled'
    and h.debut >= (p_du - 3)::timestamp at time zone 'Europe/Paris' and h.debut < (p_au + 26)::timestamp at time zone 'Europe/Paris'
),
acc as (select * from reservation where final_status = 'accepted'),

-- ── Règle 1 : départ sans ménage prévu ──
dep as (
  select r.*, b.code as b_code, b.hospitable_name as b_nom, coalesce(b.agence, 'dcb') as b_agence, b.secteur as b_secteur,
         nx.arrival_date as nx_arr, nx.departure_date as nx_dep,
         (nx.arrival_date = r.departure_date and (nx.owner_stay or (r.guest_name is not null and nx.guest_name = r.guest_name) or nx.guest_name ilike 'prolong%')) as fondu
  from acc r
  join bien b on b.id = r.bien_id
  left join lateral (select n.* from acc n where n.bien_id = r.bien_id and n.id <> r.id and n.arrival_date >= r.departure_date
                     order by n.arrival_date limit 1) nx on true
  where r.departure_date between p_du and p_au
    and not coalesce(r.owner_stay, false)
    and coalesce(trim(r.sans_menage_motif), '') = ''
    and not coalesce(r.menage_proprio_annule, false)
    and not coalesce(resa_est_etudiant(r.platform, r.guest_name, r.arrival_date, r.departure_date), false)
    and coalesce(b.statut_location, 'saisonnier') = 'saisonnier'
    and coalesce(b.hospitable_etat, '') <> 'muted'
),
dep_f as (
  select dep.*, case when fondu then nx_dep + 2 when nx_arr is not null then greatest(departure_date + 2, nx_arr) else departure_date + 7 end as fin_fenetre
  from dep
),
r1 as (
  select 'depart_sans_menage'::text as genre, 'depart:' || r.id as cle, 'corriger'::text as groupe,
         r.bien_id, r.b_code, r.b_nom, r.b_agence, r.b_secteur, r.departure_date as date_ref,
         case when r.checkout_time ~ '^\d{1,2}:\d{2}' then r.checkout_time::time end as heure,
         null::uuid as mission_id, null::text as task_id, r.id as reservation_id, r.code as reservation_code,
         null::uuid as ae_id, null::text as ae_prenom,
         hub_echeance(r.departure_date, r.booking_date) as echeance,
         'Départ du ' || to_char(r.departure_date, 'DD/MM') || coalesce(' (' || nullif(trim(r.guest_name), '') || coalesce(', ' || r.platform, '') || ')', '')
           || ' sans ménage prévu : ni tâche Hospitable, ni mission'
           || coalesce(case when r.nx_arr = r.departure_date then ', et un séjour arrive le jour même' else ', prochaine arrivée le ' || to_char(r.nx_arr, 'DD/MM') end, '') as pourquoi
  from dep_f r
  where not exists (select 1 from mis m where m.bien_id = r.bien_id and m.type_mission in ('checkout', 'cleaning', 'recouche', 'autre')
                      and (m.reservation_id = r.id or m.d between r.departure_date and r.fin_fenetre))
    and not exists (select 1 from tac t where t.bien_id = r.bien_id and t.type_ph in ('menage', 'recouche', 'check_out', 'technique')
                      and t.d between r.departure_date and r.fin_fenetre)
),

-- ── Règle 2 : ménage sans séjour (résa d'origine annulée, aucun autre séjour) ──
men as (
  select m.mission_id, m.task_id, m.bien_id, m.ae_id, m.d, m.h, t.reservation_code as t_code, m.reservation_id
  from mis m left join tac t on t.task_id = m.task_id
  where m.type_mission in ('checkout', 'cleaning') and m.d between p_du and p_au
  union all
  select null, t.task_id, t.bien_id, t.ae_id, t.d, t.h, t.reservation_code, null
  from tac t
  where t.type_ph = 'menage' and t.d between p_du and p_au and not exists (select 1 from mis m where m.task_id = t.task_id)
),
r2 as (
  select 'menage_sans_sejour'::text, 'orphelin:' || coalesce(x.mission_id::text, 't:' || x.task_id), 'corriger'::text,
         x.bien_id, b.code, b.hospitable_name, coalesce(b.agence, 'dcb'), b.secteur, x.d, x.h,
         x.mission_id, x.task_id, o.id, o.code, x.ae_id, a.prenom,
         hub_echeance(x.d, null),
         'Ménage prévu le ' || to_char(x.d, 'DD/MM') || ' pour la résa ' || coalesce(o.code, '?') || ' ('
           || coalesce(nullif(trim(o.guest_name), ''), 'voyageur ?') || ', ' || coalesce(o.final_status, '?') || ') : aucun séjour ne le justifie'
  from men x
  join bien b on b.id = x.bien_id
  left join auto_entrepreneur a on a.id = x.ae_id
  join lateral (select r.* from reservation r
                where (x.reservation_id is not null and r.id = x.reservation_id)
                   or (x.reservation_id is null and x.t_code is not null and r.code = x.t_code and r.bien_id = x.bien_id)
                limit 1) o on coalesce(o.final_status, '') <> 'accepted'
  where not exists (select 1 from acc s where s.bien_id = x.bien_id and s.arrival_date <= x.d and s.departure_date >= x.d - 14)
),

-- ── Règle 3 : AE en congé ou jour off (hors repos récurrents) ──
assign as (
  select m.mission_id, m.task_id, m.bien_id, m.ae_id, m.d, m.h, m.created_at as depuis from mis m where m.ae_id is not null and m.d between p_du and p_au
  union all
  select null, t.task_id, t.bien_id, t.ae_id, t.d, t.h, t.created_at from tac t
  where t.ae_id is not null and t.d between p_du and p_au and coalesce(t.assignment_status, '') not in ('rejected', 'unassigned')
    and not exists (select 1 from mis m where m.task_id = t.task_id)
),
assign_ae as (select x.*, a.prenom, staff_slug(a.prenom) as slug from assign x join auto_entrepreneur a on a.id = x.ae_id),
absence as (
  select x.mission_id, x.task_id, x.bien_id, x.ae_id, x.prenom, x.d, x.h, x.depuis,
         l.created_at as pose_le,
         'en congé du ' || to_char(l.start_date::date, 'DD/MM') || ' au ' || to_char(l.end_date::date, 'DD/MM') as quoi
  from assign_ae x
  join staff_leave l on l.staff_id = x.slug and coalesce(l.type, '') <> 'repos' and coalesce(l.recurring, '') = ''
    and x.d between l.start_date::date and l.end_date::date
    and not (x.d::text = any(string_to_array(coalesce(l.exceptions, ''), ',')))
  union all
  select x.mission_id, x.task_id, x.bien_id, x.ae_id, x.prenom, x.d, x.h, x.depuis, o.created_at,
         'en jour off' || case when o.am_off and o.pm_off then '' when o.am_off then ' le matin' else ' l''après-midi' end
  from assign_ae x
  join staff_off o on o.staff_id = x.slug and o.date = x.d::text
  where (o.am_off and o.pm_off or (o.am_off and x.h < time '13:00') or (o.pm_off and x.h >= time '13:00'))
    and not exists (select 1 from staff_leave rp where rp.staff_id = x.slug and rp.type = 'repos' and coalesce(rp.recurring, '') <> ''
                      and extract(dow from x.d)::text = any(string_to_array(rp.recurring, ','))
                      and not (x.d::text = any(string_to_array(coalesce(rp.exceptions, ''), ','))))
),
r3 as (
  select distinct on (coalesce(x.mission_id::text, x.task_id))
         'ae_conge'::text, 'conge:' || coalesce(x.mission_id::text, 't:' || x.task_id), 'trouver_ae'::text,
         x.bien_id, b.code, b.hospitable_name, coalesce(b.agence, 'dcb'), b.secteur, x.d, x.h,
         x.mission_id, x.task_id, null::uuid, null::text, x.ae_id, x.prenom,
         hub_echeance(x.d, greatest(x.depuis, x.pose_le)),
         coalesce(x.prenom, 'L''AE') || ' est ' || x.quoi || ' et a une mission ce jour-là'
  from absence x join bien b on b.id = x.bien_id
  order by coalesce(x.mission_id::text, x.task_id), x.pose_le
),

-- ── Règle 4 : refusée dans « Mes missions », toujours assignée dans Hospitable ──
r4 as (
  select 'refus_toujours_assigne'::text, 'refus:' || m.id, 'trouver_ae'::text,
         m.bien_id, b.code, b.hospitable_name, coalesce(b.agence, 'dcb'), b.secteur, m.date_mission, m.heure_mission,
         m.id, h.task_id, null::uuid, null::text, ma.ae_id, a.prenom,
         hub_echeance(m.date_mission, ma.refuse_le),
         coalesce(a.prenom, 'L''AE') || ' a refusé le ' || to_char(ma.refuse_le at time zone 'Europe/Paris', 'DD/MM')
           || ' mais la tâche lui est toujours assignée dans Hospitable (' || coalesce(h.assignment_status, '?') || ') : elle reste dans son agenda'
  from mission_acceptation ma
  join mission_menage m on m.id = ma.mission_id and m.ae_id = ma.ae_id
  join hospitable_tache h on h.task_id = split_part(m.ical_uid, '@', 1) and m.ical_uid ~* '@smartbnb\.io$'
  join bien b on b.id = m.bien_id
  left join auto_entrepreneur a on a.id = ma.ae_id
  where ma.statut = 'refusee' and m.date_mission between p_du and p_au
    and coalesce(m.statut, '') not in ('cancelled', 'refuse', 'annule')
    and h.disparu_le is null and h.assignment_status in ('pending', 'accepted') and h.ae_id = ma.ae_id
    and h.vu_le > greatest(ma.refuse_le, coalesce(ma.hospitable_desassigne_le, ma.refuse_le)) + interval '20 minutes'
),
tout as (select * from r1 union all select * from r2 union all select * from r3 union all select * from r4)
select t.genre, t.cle, t.groupe, t.bien_id, t.b_code, t.b_nom, t.b_agence, t.b_secteur, t.date_ref, t.heure,
       t.mission_id, t.task_id, t.reservation_id, t.reservation_code, t.ae_id, t.ae_prenom,
       t.echeance, t.echeance < now(), t.pourquoi
from tout t
where not exists (select 1 from mission_journal j where j.ecart_cle = t.cle and j.type = 'ecart_ignore')
$$;

revoke all on function public.mission_ecarts(date, date) from public, anon, authenticated;
grant execute on function public.mission_ecarts(date, date) to service_role;

-- ── 4. Vue du hub : J-1 → J+21 ──────────────────────────────────────────────
create or replace view public.mission_ecart_v with (security_invoker = true) as
select * from public.mission_ecarts((now() at time zone 'Europe/Paris')::date - 1, (now() at time zone 'Europe/Paris')::date + 21);
revoke all on public.mission_ecart_v from anon, authenticated;
grant select on public.mission_ecart_v to service_role;

-- ── 5. Point du matin : seulement ce qui est EN RETARD et pas déjà signalé ailleurs ──
--   • depart_sans_menage : déjà couvert par alerte-sejour-sans-menage (départs J → J+2 en urgent) → exclu ;
--   • refus_toujours_assigne : exclu tant que le refus est dans « Missions AE à réattribuer »
--     (missions_acceptation_a_signaler, qui dit déjà « toujours assignée dans Hospitable ») ;
--   • rien de passé (le passé relève des alertes compta : ménages orphelins, séjours sans ménage).
create or replace view public.mission_ecart_a_signaler with (security_invoker = true) as
select e.*
from public.mission_ecart_v e
where e.en_retard
  and e.date_ref >= (now() at time zone 'Europe/Paris')::date
  and e.genre in ('ae_conge', 'refus_toujours_assigne', 'menage_sans_sejour')
  and not (e.genre = 'refus_toujours_assigne' and exists (
    select 1 from public.missions_acceptation_a_signaler s where s.mission_id = e.mission_id and s.categorie = 'refus_a_reattribuer'));
revoke all on public.mission_ecart_a_signaler from anon, authenticated;
grant select on public.mission_ecart_a_signaler to service_role;

comment on view public.mission_ecart_v is 'Lot 3a hub des tâches (migration 384) : écarts Hospitable ↔ règles sur J-1 → J+21 (départ sans ménage, ménage sans séjour, AE en congé, refus toujours assigné). Lecture service_role (api/mission-hub).';

-- ── 6. B — extra « réglé hors circuit » (sans toucher au mois clôturé) ────────
create or replace function public.extra_regler_hors_circuit(p_id uuid, p_motif text, p_auteur text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.prestation_hors_forfait;
  v_auteur text;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin') or public.auth_user_is_bureau()) then
    raise exception 'acces_refuse';
  end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'motif_obligatoire'; end if;
  select * into v from public.prestation_hors_forfait where id = p_id for update;
  if not found then raise exception 'extra_introuvable'; end if;
  if v.statut <> 'en_attente' then raise exception 'extra_pas_en_attente (statut %)', v.statut; end if;
  v_auteur := coalesce(nullif(trim(p_auteur), ''),
    (select prenom from public.auto_entrepreneur where ae_user_id = auth.uid() limit 1),
    (select split_part(email, '@', 1) from public.staff_users where auth_user_id = auth.uid() limit 1), 'bureau');
  -- Seul le statut change : montant, durée, imputation, mois et bien restent identiques → autorisé par
  -- check_cloture_bien_fige même sur un mois clôturé, et aucune écriture comptable n'en découle.
  update public.prestation_hors_forfait set statut = 'regle_hors_circuit', updated_at = now() where id = p_id;
  insert into public.mission_journal (mission_id, bien_id, prestation_id, type, avant, apres, texte, auteur_id, auteur_nom)
  values (v.mission_id, v.bien_id, v.id, 'extra_regle_hors_circuit',
          jsonb_build_object('statut', v.statut),
          jsonb_build_object('statut', 'regle_hors_circuit', 'montant_cts', v.montant, 'mois', v.mois, 'type_imputation', v.type_imputation),
          'Extra « ' || coalesce(v.description, '?') || ' » (' || to_char(v.montant / 100.0, 'FM999990.00') || ' €, ' || v.mois || ') réglé hors circuit — ' || trim(p_motif),
          auth.uid(), v_auteur);
  return jsonb_build_object('ok', true, 'id', v.id, 'statut', 'regle_hors_circuit');
end $$;
revoke all on function public.extra_regler_hors_circuit(uuid, text, text) from public, anon;
grant execute on function public.extra_regler_hors_circuit(uuid, text, text) to authenticated, service_role;

comment on function public.extra_regler_hors_circuit(uuid, text, text) is 'Extra AE déjà payé hors du circuit normal (ex. relevé AE qui comptait les extras non validés, corrigé le 10/10/2026) : statut regle_hors_circuit, mois clôturé intact, aucune déduction de loyer, journalisé (migration 384).';

-- Décision d'Oïhan du 10/10/2026 : LINGE 15 € PANORAMA du 26/03/2026 (Kathy), déjà payé.
select public.extra_regler_hors_circuit(p.id,
  'déjà payé à Kathy (relevé AE qui comptait les extras non validés) ; mars 2026 clôturé, aucune déduction de loyer ajoutée — décision Oïhan 10/10/2026',
  'Oïhan (décision du 10/10/2026)')
from public.prestation_hors_forfait p
join public.bien b on b.id = p.bien_id
join public.auto_entrepreneur a on a.id = p.ae_id
where b.code = 'PANORAMA' and a.prenom = 'Kathy' and p.date_prestation = '2026-03-26' and p.montant = 1500 and p.statut = 'en_attente';
