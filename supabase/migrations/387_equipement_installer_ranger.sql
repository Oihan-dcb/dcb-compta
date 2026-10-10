-- 387 — Équipements loués pour un séjour : « installer / ranger » sur les ménages (10/10/2026, demande Oïhan)
-- Un équipement (lit bébé, chaise haute…) est loué POUR UN SÉJOUR. Le ménage qui PRÉCÈDE l'arrivée l'installe,
-- celui qui SUIT le départ le range. Rattachement par BIEN + DATES (jamais via la résa d'une tâche Hospitable,
-- peu fiable) : séjour = résa liée (equipment_bookings.hospitable_resa_id), sinon résa acceptée du bien qui
-- chevauche le plus de nuits, sinon les dates de la location d'équipement elles-mêmes.
--   • ménage avant = mission ménage (checkout/cleaning) du bien la plus proche AVANT ou LE JOUR de l'arrivée,
--     et pas avant le départ du séjour précédent (sinon c'est le ménage d'un autre voyageur) ;
--   • ménage après = première mission ménage du bien le jour du départ ou après (≤ 30 j).
-- Une seule logique, partagée : equipement_sejours() (interne) → mission_equipement(ids) (RPC appelée par
-- PowerHouse Aujourd'hui, le tiroir du hub et Ma journée du portail AE) et règle 5 de mission_ecarts()
-- (« À faire › Corriger » quand AUCUN ménage — mission ou tâche Hospitable — n'est prévu avant l'arrivée).
-- Mesure avant mise en place : 11 séjours avec équipement depuis mai 2026 → 11 ménages avant + 11 après
-- trouvés, 0 ligne « Corriger ». Seules les locations confirmées déclenchent « Corriger » ; les options
-- apparaissent dans les mentions avec « (option) ».

create or replace function public.equipement_sejours(p_du date, p_au date)
returns table (
  cle text, bien_id uuid, reservation_id uuid, arrivee date, depart date, voyageur text, items text,
  une_confirmee boolean, borne_avant date, mission_avant uuid, mission_apres uuid, menage_avant boolean
)
language sql stable set search_path = public as $$
with eb as (
  select eb.id, eb.bien_id, eb.hospitable_resa_id, eb.date_debut, eb.date_fin, eb.quantite, eb.statut, eb.guest_name, e.nom
  from equipment_bookings eb join equipment e on e.id = eb.equipment_id
  where eb.statut in ('confirme', 'option') and eb.bien_id is not null
    and eb.date_fin >= p_du - 45 and eb.date_debut <= p_au + 45
),
s0 as (
  select eb.*, r.id as rid, r.bien_id as r_bien, r.arrival_date as r_arr, r.departure_date as r_dep, r.guest_name as r_guest
  from eb
  left join lateral (
    select x.id, x.bien_id, x.arrival_date, x.departure_date, x.guest_name from reservation x
    where x.final_status = 'accepted'
      and ((eb.hospitable_resa_id is not null and x.hospitable_id = eb.hospitable_resa_id)
        or (eb.hospitable_resa_id is null and x.bien_id = eb.bien_id and x.arrival_date <= eb.date_fin and x.departure_date > eb.date_debut))
    order by least(x.departure_date, eb.date_fin + 1) - greatest(x.arrival_date, eb.date_debut) desc, x.arrival_date
    limit 1) r on true
  -- résa liée connue mais plus acceptée (annulée…) : la location d'équipement est caduque
  where r.id is not null or eb.hospitable_resa_id is null
     or not exists (select 1 from reservation x where x.hospitable_id = eb.hospitable_resa_id)
),
s as (
  select coalesce(rid::text, 'eb:' || bien_id || ':' || date_debut) as cle,
         coalesce(r_bien, bien_id) as bien_id, rid as reservation_id,
         coalesce(r_arr, date_debut) as arrivee, coalesce(r_dep, date_fin) as depart,
         max(coalesce(nullif(trim(r_guest), ''), nullif(trim(guest_name), ''))) as voyageur,
         string_agg(trim(nom) || case when quantite > 1 then ' ×' || quantite else '' end
                    || case when statut = 'option' then ' (option)' else '' end, ', ' order by trim(nom)) as items,
         bool_or(statut = 'confirme') as une_confirmee
  from s0
  group by 1, 2, 3, 4, 5
),
s_b as (
  select s.*,
         -- séjour précédent « fondu » (même voyageur, prolongation, séjour proprio enchaîné) : on remonte avant lui
         case when pv.departure_date is null then s.arrivee - 60
              when pv.departure_date = s.arrivee and (pv.owner_stay or pv.guest_name = s.voyageur or pv.guest_name ilike 'prolong%' or s.voyageur ilike 'prolong%')
                then pv.arrival_date - 30
              else pv.departure_date end as borne_avant
  from s
  left join lateral (select r.arrival_date, r.departure_date, r.owner_stay, r.guest_name from reservation r
                     where r.bien_id = s.bien_id and r.final_status = 'accepted' and r.departure_date <= s.arrivee
                       and r.id is distinct from s.reservation_id
                     order by r.departure_date desc limit 1) pv on true
  where s.depart >= p_du and s.arrivee <= p_au
)
select s.cle, s.bien_id, s.reservation_id, s.arrivee, s.depart, s.voyageur, s.items, s.une_confirmee, s.borne_avant,
       av.id, ap.id,
       av.id is not null or exists (
         select 1 from hospitable_tache h
         where h.bien_id = s.bien_id and h.type_ph = 'menage' and h.disparu_le is null and coalesce(h.assignment_status, '') <> 'cancelled'
           and (h.debut at time zone 'Europe/Paris')::date between s.borne_avant and s.arrivee)
from s_b s
left join lateral (select m.id from mission_menage m
                   where m.bien_id = s.bien_id and m.type_mission in ('checkout', 'cleaning')
                     and coalesce(m.statut, '') not in ('cancelled', 'refuse', 'annule')
                     and m.date_mission between s.borne_avant and s.arrivee
                   order by m.date_mission desc, m.heure_mission desc nulls last limit 1) av on true
left join lateral (select m.id from mission_menage m
                   where m.bien_id = s.bien_id and m.type_mission in ('checkout', 'cleaning')
                     and coalesce(m.statut, '') not in ('cancelled', 'refuse', 'annule')
                     and m.date_mission between s.depart and s.depart + 30
                   order by m.date_mission, m.heure_mission nulls last limit 1) ap on true
$$;
revoke all on function public.equipement_sejours(date, date) from public, anon, authenticated;
grant execute on function public.equipement_sejours(date, date) to service_role;

-- Mentions par mission (PowerHouse + portail AE). Mêmes droits que terrain_contexte_sejours (319) :
-- l'AE ne voit que ses missions, le bureau tout, le staff restreint ses secteurs.
create or replace function public.mission_equipement(p_mission_ids uuid[])
returns table (mission_id uuid, sens text, items text, arrivee date, depart date, voyageur text, libelle text)
language sql stable security definer set search_path = public as $$
  with ms as (
    select m.id, m.date_mission from mission_menage m
    where m.id = any(p_mission_ids)
      and (auth_user_owns_ae(m.ae_id) or auth_user_is_bureau()
           or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))))
  ),
  bornes as (select min(date_mission) - 31 as du, max(date_mission) + 61 as au from ms)
  select ms.id, x.sens, s.items, s.arrivee, s.depart, s.voyageur,
         case x.sens
           when 'installer' then '🧸 À installer : ' || s.items || ' — arrivée le ' || to_char(s.arrivee, 'DD/MM/YYYY')
           else '🧸 À ranger : ' || s.items || ' — départ le ' || to_char(s.depart, 'DD/MM/YYYY') end
           || coalesce(' (' || s.voyageur || ')', '')
  from bornes b
  cross join lateral equipement_sejours(b.du, b.au) s
  cross join lateral (values ('installer', s.mission_avant), ('ranger', s.mission_apres)) x(sens, mid)
  join ms on ms.id = x.mid
  where b.du is not null
  order by ms.id, x.sens, s.arrivee;
$$;
revoke all on function public.mission_equipement(uuid[]) from public, anon;
grant execute on function public.mission_equipement(uuid[]) to authenticated, service_role;

-- mission_ecarts() : identique à la 385 + règle 5.
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
  from equipement_sejours(p_du, p_au) s
  join bien b on b.id = s.bien_id
  left join reservation r on r.id = s.reservation_id
  where s.une_confirmee and not s.menage_avant and s.arrivee between p_du and p_au
),
tout as (select * from r1 union all select * from r2 union all select * from r3 union all select * from r4 union all select * from r5)
select t.genre, t.cle, t.groupe, t.bien_id, t.b_code, t.b_nom, t.b_agence, t.b_secteur, t.date_ref, t.heure,
       t.mission_id, t.task_id, t.reservation_id, t.reservation_code, t.ae_id, t.ae_prenom,
       t.echeance, t.echeance < now(), t.pourquoi
from tout t
where not exists (select 1 from mission_journal j where j.ecart_cle = t.cle and j.type = 'ecart_ignore')
$$;

-- Point du matin : une arrivée avec équipement sans ménage, en retard (J-2 18 h passé), mérite l'alerte.
create or replace view public.mission_ecart_a_signaler with (security_invoker = true) as
select e.*
from public.mission_ecart_v e
where e.en_retard
  and e.date_ref >= (now() at time zone 'Europe/Paris')::date
  and e.genre in ('ae_conge', 'refus_toujours_assigne', 'menage_sans_sejour', 'equipement_sans_menage')
  and not (e.genre = 'refus_toujours_assigne' and exists (
    select 1 from public.missions_acceptation_a_signaler s where s.mission_id = e.mission_id and s.categorie = 'refus_a_reattribuer'));
revoke all on public.mission_ecart_a_signaler from anon, authenticated;
grant select on public.mission_ecart_a_signaler to service_role;
