-- 391 — Équipement loué : le RÉCUPÉRER après le séjour (10/10/2026, règle Oïhan)
-- « Si un équipement est loué pour un séjour (y compris séjour PROPRIO), il faut le récupérer après. » Normalement
-- un ménage suit toujours un séjour proprio ; exception rare : le proprio fait son ménage (reservation.sans_menage_motif).
-- Règle 6 de mission_ecarts() « equipement_sans_recuperation » (À faire › Corriger) : séjour avec location confirmée,
-- aucun ménage / passage prévu après le départ → « qui récupère l'équipement ? ». Le motif « sans ménage » n'exempte pas.
-- La règle 5 (« avant l'arrivée », 387) couvre déjà les séjours proprio (equipement_sejours ne les exclut pas).
-- Point du matin : seulement en retard (J-2 18 h avant le départ), via mission_ecart_a_signaler.
-- Mesure historique (avril → décembre 2026) : 11 séjours avec équipement, 11 ménages le jour du départ → 0 ligne.

-- mission_ecarts() : identique à la 387 + règle 6 (et la règle 1 nomme l'équipement à récupérer).
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
-- séjours acceptés autour de la période (colonnes utiles seulement : reservation porte hospitable_raw, lourd)
acc as (
  select id, bien_id, arrival_date, departure_date, owner_stay, guest_name from reservation
  where final_status = 'accepted' and departure_date >= p_du - 20
),
-- séjours avec équipement loué (387), calculés une seule fois pour les règles 1, 5 et 6
eqs as (select * from equipement_sejours(p_du, p_au)),

-- ── Règle 1 : départ sans ménage prévu ──
dep as (
  select r.id, r.bien_id, r.code, r.platform, r.guest_name, r.arrival_date, r.departure_date, r.checkout_time, r.booking_date,
         b.code as b_code, b.hospitable_name as b_nom, coalesce(b.agence, 'dcb') as b_agence, b.secteur as b_secteur,
         nx.arrival_date as nx_arr, nx.departure_date as nx_dep,
         (nx.arrival_date = r.departure_date and (nx.owner_stay or (r.guest_name is not null and nx.guest_name = r.guest_name) or nx.guest_name ilike 'prolong%')) as fondu
  from reservation r
  join bien b on b.id = r.bien_id
  left join lateral (select n.* from acc n where n.bien_id = r.bien_id and n.id <> r.id and n.arrival_date >= r.departure_date
                     order by n.arrival_date limit 1) nx on true
  where r.final_status = 'accepted' and r.departure_date between p_du and p_au
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
           || coalesce(case when r.nx_arr = r.departure_date then ', et un séjour arrive le jour même' else ', prochaine arrivée le ' || to_char(r.nx_arr, 'DD/MM') end, '')
           || coalesce(' — équipement loué à récupérer : ' || (select string_agg(q.items, ', ') from eqs q where q.reservation_id = r.id and q.une_confirmee), '') as pourquoi
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
  join lateral (select r.id, r.code, r.guest_name, r.final_status from reservation r
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
-- ── Règle 5 (387) : séjour avec équipement réservé, aucun ménage prévu avant l'arrivée ──
r5 as (
  select 'equipement_sans_menage'::text, 'equip:' || s.cle, 'corriger'::text,
         s.bien_id, b.code, b.hospitable_name, coalesce(b.agence, 'dcb'), b.secteur, s.arrivee, null::time,
         null::uuid, null::text, s.reservation_id, r.code, null::uuid, null::text,
         hub_echeance(s.arrivee, null),
         'Arrivée du ' || to_char(s.arrivee, 'DD/MM/YYYY') || coalesce(' (' || s.voyageur || ')', '')
           || ' avec ' || s.items || ' : aucun ménage prévu avant l''arrivée, personne n''installera l''équipement'
  from eqs s
  join bien b on b.id = s.bien_id
  left join reservation r on r.id = s.reservation_id
  where s.une_confirmee and not s.menage_avant and s.arrivee between p_du and p_au
),
-- ── Règle 6 (391) : séjour avec équipement réservé (séjour proprio compris), aucun passage prévu APRÈS le départ ──
-- Couvre : mission ménage / recouche / autre, tâche Hospitable ménage / recouche / check-out / technique, ou mission
-- PowerHouse (manual_missions) sur le bien entre le départ et la fin de fenêtre (même fenêtre que la règle 1 :
-- prochaine arrivée, ≥ J+2 ; séjour enchaîné « fondu » → son départ + 2 ; sans suite → J+7).
-- Le séjour « sans ménage » (sans_menage_motif, ménage du proprio) N'exempte PAS : quelqu'un doit récupérer l'équipement.
-- Pas de doublon : si la règle 1 signale déjà ce départ (aucun ménage, aucun motif), sa phrase nomme l'équipement.
eq6 as (
  select s.*, r.code as r_code, r.owner_stay, nullif(trim(r.sans_menage_motif), '') as motif, r.menage_proprio_annule,
         nx.arrival_date as nx_arr, nx.departure_date as nx_dep,
         (nx.arrival_date = s.depart and (nx.owner_stay or (s.voyageur is not null and nx.guest_name = s.voyageur) or nx.guest_name ilike 'prolong%')) as fondu
  from eqs s
  left join reservation r on r.id = s.reservation_id
  left join lateral (select n.* from acc n where n.bien_id = s.bien_id and n.id is distinct from s.reservation_id and n.arrival_date >= s.depart
                     order by n.arrival_date limit 1) nx on true
  where s.une_confirmee and s.depart between p_du and p_au
),
eq6_f as (
  select e.*, least(case when fondu then nx_dep + 2 when nx_arr is not null then greatest(depart + 2, nx_arr) else depart + 7 end, p_au + 25) as fin_fenetre
  from eq6 e
),
r6 as (
  select 'equipement_sans_recuperation'::text, 'equip_retour:' || s.cle, 'corriger'::text,
         s.bien_id, b.code, b.hospitable_name, coalesce(b.agence, 'dcb'), b.secteur, s.depart, null::time,
         null::uuid, null::text, s.reservation_id, s.r_code, null::uuid, null::text,
         hub_echeance(s.depart, null),
         'Départ du ' || to_char(s.depart, 'DD/MM/YYYY')
           || case when s.owner_stay then ' (séjour propriétaire' || coalesce(', ' || s.voyageur, '') || ')' else coalesce(' (' || s.voyageur || ')', '') end
           || ' : ' || s.items || ' à récupérer, aucun ménage ni passage prévu après le départ'
           || case when s.motif is not null then ' (séjour noté sans ménage : « ' || s.motif || ' »)'
                   when s.menage_proprio_annule then ' (ménage annulé par le propriétaire)' else '' end
           || ' — qui récupère l''équipement ?'
  from eq6_f s
  join bien b on b.id = s.bien_id
  where not exists (select 1 from mis m where m.bien_id = s.bien_id and m.type_mission in ('checkout', 'cleaning', 'recouche', 'autre')
                      and m.d between s.depart and s.fin_fenetre)
    and not exists (select 1 from tac t where t.bien_id = s.bien_id and t.type_ph in ('menage', 'recouche', 'check_out', 'technique')
                      and t.d between s.depart and s.fin_fenetre)
    and not exists (select 1 from manual_missions mm where mm.bien_id = s.bien_id and not coalesce(mm.deleted, false)
                      and coalesce(mm.status, '') not in ('cancelled', 'annule')
                      and (case when mm.date ~ '^\d{4}-\d{2}-\d{2}$' then mm.date::date end) between s.depart and s.fin_fenetre)
    and not exists (select 1 from r1 where r1.reservation_id = s.reservation_id)
),
tout as (select * from r1 union all select * from r2 union all select * from r3 union all select * from r4 union all select * from r5 union all select * from r6)
select t.genre, t.cle, t.groupe, t.bien_id, t.b_code, t.b_nom, t.b_agence, t.b_secteur, t.date_ref, t.heure,
       t.mission_id, t.task_id, t.reservation_id, t.reservation_code, t.ae_id, t.ae_prenom,
       t.echeance, t.echeance < now(), t.pourquoi
from tout t
where not exists (select 1 from mission_journal j where j.ecart_cle = t.cle and j.type = 'ecart_ignore')
$$;

-- Point du matin : équipement sans ménage avant l'arrivée OU sans passage après le départ, en retard seulement.
create or replace view public.mission_ecart_a_signaler with (security_invoker = true) as
select e.*
from public.mission_ecart_v e
where e.en_retard
  and e.date_ref >= (now() at time zone 'Europe/Paris')::date
  and e.genre in ('ae_conge', 'refus_toujours_assigne', 'menage_sans_sejour', 'equipement_sans_menage', 'equipement_sans_recuperation')
  and not (e.genre = 'refus_toujours_assigne' and exists (
    select 1 from public.missions_acceptation_a_signaler s where s.mission_id = e.mission_id and s.categorie = 'refus_a_reattribuer'));
revoke all on public.mission_ecart_a_signaler from anon, authenticated;
grant select on public.mission_ecart_a_signaler to service_role;

comment on view public.mission_ecart_v is 'Hub des tâches : écarts Hospitable ↔ règles sur J-1 → J+21 (départ sans ménage, ménage sans séjour, AE en congé, refus toujours assigné, équipement sans ménage avant l''arrivée (387) ou sans passage après le départ (391)). Lecture service_role (api/mission-hub).';
