-- 467 — HEURE EFFECTIVE DU SÉJOUR (arrivée anticipée / départ tardif payés) + prestations horaires (17/10/2026, Oïhan).
-- Suite de 463 (paiement des options du portail voyageur). SOURCE UNIQUE de l'heure d'arrivée / de départ d'un séjour :
--   vue reservation_heure_v : heure vendue (reservation_horaire, PowerHouse — jamais Hospitable)
--                             > heure par défaut du bien (bien.heure_*_defaut : page Réserver, contrat, portail)
--                             > heure Hospitable de la résa (checkin_time / checkout_time) > 16:00 / 10:00.
-- Lue par : terrain_contexte_sejours (portail AE « Ma journée »), mission_ecarts (hub), PowerHouse (fiche du séjour,
-- portail voyageur, IA voyageurs, rappels terrain) ; à lire par l'Accueil / hub (api/dashboard.js, api/mission-hub.js).
-- Missions : un départ tardif payé DÉCALE la mission de ménage (checkout) du jour du départ à l'heure de départ ; une
-- arrivée anticipée AVANCE la mission d'accueil (checkin) du jour de l'arrivée — jamais une mission commencée / validée ;
-- journal mission_journal « heure_changee » ; heure remise à l'heure standard du bien si l'option est remboursée.
-- Prestations : départ jusqu'à 12 h / 14 h, arrivée dès 14 h / 13 h (DCB et Lauïan), payables, créneau contrôlé ; les deux
-- « demandes » gratuites d'origine sont désactivées (remplacées par les prestations payantes — pratique du marché).

-- ── 1. Vue de l'heure effective ───────────────────────────────────────────────────────────────────────────────
create or replace function public.heure_hhmm(t text) returns text language sql immutable as $$
  select case
    when t ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then to_char((t::timestamptz) at time zone 'Europe/Paris', 'HH24:MI')
    when t ~ '^\d{1,2}[:h]\d{2}' then lpad(split_part(replace(t, 'h', ':'), ':', 1), 2, '0') || ':' || substr(split_part(replace(t, 'h', ':'), ':', 2), 1, 2)
    when t ~ '^\d{1,2}h?$' then lpad(replace(t, 'h', ''), 2, '0') || ':00'
  end
$$;

create or replace view public.reservation_heure_v with (security_invoker = true) as
select r.id as reservation_id, r.hospitable_id, r.code, r.bien_id, r.arrival_date, r.departure_date, r.final_status, r.owner_stay, r.guest_count,
  coalesce(ha.heure, heure_hhmm(b.heure_arrivee_defaut), heure_hhmm(r.checkin_time), '16:00') as heure_arrivee,
  coalesce(hd.heure, heure_hhmm(b.heure_depart_defaut), heure_hhmm(r.checkout_time), '10:00') as heure_depart,
  case when ha.heure is not null then 'vendue' when heure_hhmm(b.heure_arrivee_defaut) is not null then 'bien' when heure_hhmm(r.checkin_time) is not null then 'hospitable' else 'defaut' end as source_arrivee,
  case when hd.heure is not null then 'vendue' when heure_hhmm(b.heure_depart_defaut) is not null then 'bien' when heure_hhmm(r.checkout_time) is not null then 'hospitable' else 'defaut' end as source_depart,
  ((r.arrival_date + coalesce(ha.heure, heure_hhmm(b.heure_arrivee_defaut), heure_hhmm(r.checkin_time), '16:00')::time) at time zone 'Europe/Paris') as debut,
  ((r.departure_date + coalesce(hd.heure, heure_hhmm(b.heure_depart_defaut), heure_hhmm(r.checkout_time), '10:00')::time) at time zone 'Europe/Paris') as fin
from public.reservation r
left join public.bien b on b.id = r.bien_id
left join lateral (select h.heure from public.reservation_horaire h where h.resa_hospitable_id = r.hospitable_id and h.sens = 'arrivee' and h.annule_le is null order by h.cree_le desc limit 1) ha on true
left join lateral (select h.heure from public.reservation_horaire h where h.resa_hospitable_id = r.hospitable_id and h.sens = 'depart' and h.annule_le is null order by h.cree_le desc limit 1) hd on true;
comment on view public.reservation_heure_v is '467 : heure EFFECTIVE d''arrivée / de départ d''un séjour (source unique) : vendue (reservation_horaire) > bien.heure_*_defaut > Hospitable > 16:00/10:00 ; debut / fin = instants (heure de Paris).';
revoke all on public.reservation_heure_v from anon;
grant select on public.reservation_heure_v to authenticated, service_role;

-- reservation_horaire lisible par l'équipe (même périmètre que reservation) ; écriture : serveur seulement.
drop policy if exists reservation_horaire_staff_lecture on public.reservation_horaire;
create policy reservation_horaire_staff_lecture on public.reservation_horaire for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
grant select on public.reservation_horaire to authenticated;

-- ── 2. Missions décalées par l'heure vendue ─────────────────────────────────────────────────────────────────────
-- Départ tardif → mission checkout du jour du départ pas avant l'heure de départ ; arrivée anticipée → mission checkin du
-- jour de l'arrivée pas après l'heure d'arrivée. Jamais une mission commencée (mission_terrain) / validée / annulée.
create or replace function public.horaire_missions_appliquer(p_resa_hospitable_id text, p_sens text, p_par text default 'option payée') returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_h text; v_std text; m record; n integer := 0; v_cible time;
begin
  select rr.bien_id, rr.arrival_date, rr.departure_date, b.heure_arrivee_defaut, b.heure_depart_defaut into r
    from reservation rr left join bien b on b.id = rr.bien_id where rr.hospitable_id = p_resa_hospitable_id limit 1;
  if r.bien_id is null then return 0; end if;
  select h.heure into v_h from reservation_horaire h where h.resa_hospitable_id = p_resa_hospitable_id and h.sens = p_sens and h.annule_le is null order by h.cree_le desc limit 1;
  v_std := case when p_sens = 'depart' then coalesce(heure_hhmm(r.heure_depart_defaut), '10:00') else coalesce(heure_hhmm(r.heure_arrivee_defaut), '16:00') end;
  for m in select mm.id, mm.heure_mission from mission_menage mm
            where mm.bien_id = r.bien_id and mm.statut not in ('cancelled', 'valide', 'refuse')
              and ((p_sens = 'depart' and mm.type_mission = 'checkout' and mm.date_mission = r.departure_date)
                or (p_sens = 'arrivee' and mm.type_mission = 'checkin' and mm.date_mission = r.arrival_date))
              and not exists (select 1 from mission_terrain t where t.mission_id = mm.id)
  loop
    if v_h is not null then
      -- heure vendue : départ → ménage pas avant ; arrivée → accueil pas après
      v_cible := case when p_sens = 'depart' then greatest(coalesce(m.heure_mission, v_h::time), v_h::time) else least(coalesce(m.heure_mission, v_h::time), v_h::time) end;
    else
      -- option retirée : on ne revient à l'heure standard que si la mission est restée à l'heure vendue
      continue when not exists (select 1 from mission_journal j where j.mission_id = m.id and j.type = 'heure_changee' and j.apres->>'source' = 'option_horaire' and (j.apres->>'heure') = to_char(m.heure_mission, 'HH24:MI'));
      v_cible := v_std::time;
    end if;
    if m.heure_mission is distinct from v_cible then
      update mission_menage set heure_mission = v_cible, updated_at = now() where id = m.id;
      insert into mission_journal (mission_id, bien_id, type, avant, apres, texte, auteur_nom)
      values (m.id, r.bien_id, 'heure_changee', jsonb_build_object('heure', to_char(m.heure_mission, 'HH24:MI')),
              jsonb_build_object('heure', to_char(v_cible, 'HH24:MI'), 'source', 'option_horaire'),
              case when v_h is null then 'Option ' || case when p_sens = 'depart' then 'départ tardif' else 'arrivée anticipée' end || ' retirée : heure standard ' || v_std
                   when p_sens = 'depart' then 'Départ tardif payé : voyageurs jusqu''à ' || v_h || ' → ménage à ' || to_char(v_cible, 'HH24:MI')
                   else 'Arrivée anticipée payée : voyageurs dès ' || v_h || ' → accueil à ' || to_char(v_cible, 'HH24:MI') end, p_par);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.horaire_missions_appliquer(text, text, text) from public, anon, authenticated;

create or replace function public.trg_reservation_horaire_missions() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform horaire_missions_appliquer(coalesce(new.resa_hospitable_id, old.resa_hospitable_id), coalesce(new.sens, old.sens), coalesce(new.annule_par, new.cree_par, 'option payée'));
  return null;
end $$;
drop trigger if exists trg_reservation_horaire_missions on public.reservation_horaire;
create trigger trg_reservation_horaire_missions after insert or update of annule_le, heure on public.reservation_horaire
  for each row execute function public.trg_reservation_horaire_missions();

-- Mission créée APRÈS la vente (synchro des tâches) : décalée à la création.
create or replace function public.trg_mission_heure_vendue() returns trigger language plpgsql security definer set search_path = public as $$
declare v_h text;
begin
  if new.type_mission not in ('checkout', 'checkin') or new.bien_id is null or new.date_mission is null then return new; end if;
  select h.heure into v_h from reservation_horaire h join reservation r on r.hospitable_id = h.resa_hospitable_id
   where h.annule_le is null and r.bien_id = new.bien_id and r.final_status = 'accepted'
     and ((new.type_mission = 'checkout' and h.sens = 'depart' and r.departure_date = new.date_mission)
       or (new.type_mission = 'checkin' and h.sens = 'arrivee' and r.arrival_date = new.date_mission))
   order by h.cree_le desc limit 1;
  if v_h is not null then
    new.heure_mission := case when new.type_mission = 'checkout' then greatest(coalesce(new.heure_mission, v_h::time), v_h::time) else least(coalesce(new.heure_mission, v_h::time), v_h::time) end;
  end if;
  return new;
end $$;
drop trigger if exists trg_mission_heure_vendue on public.mission_menage;
create trigger trg_mission_heure_vendue before insert on public.mission_menage for each row execute function public.trg_mission_heure_vendue();

-- ── 3. Portail AE « Ma journée » : heure d'arrivée EFFECTIVE (HH:MM) ─────────────────────────────────────────────
create or replace function public.terrain_contexte_sejours(p_mission_ids uuid[])
 returns table(mission_id uuid, depart_guest text, depart_code text, depart_date date, encours_guest text, encours_code text, encours_depart date, arrivee_date date, arrivee_checkin text, arrivee_guests integer, arrivee_proprio boolean, arrivee_couchage jsonb, encours_couchage jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
  select m.id,
    rd.guest_name, rd.code, rd.departure_date,
    rc.guest_name, rc.code, rc.departure_date,
    ra.arrival_date, (select hv.heure_arrivee from reservation_heure_v hv where hv.reservation_id = ra.id), ra.guest_count, ra.owner_stay,
    case when ra.hospitable_id is not null then couchage_pour(m.bien_id, ra.hospitable_id, ra.guest_count) end,
    case when rc.hospitable_id is not null then couchage_pour(m.bien_id, rc.hospitable_id, rc.guest_count) end
  from mission_menage m
  left join reservation rd on rd.id = m.reservation_id
  left join lateral (select r.guest_name, r.code, r.departure_date, r.hospitable_id, r.guest_count from reservation r
                      where r.bien_id = m.bien_id and r.final_status = 'accepted'
                        and r.arrival_date <= m.date_mission and r.departure_date > m.date_mission
                      order by r.arrival_date desc limit 1) rc on true
  left join lateral (select r.id, r.arrival_date, r.guest_count, r.owner_stay, r.hospitable_id from reservation r
                      where r.bien_id = m.bien_id and r.final_status = 'accepted'
                        and r.arrival_date >= m.date_mission and r.arrival_date <= m.date_mission + 21
                      order by r.arrival_date limit 1) ra on true
  where m.id = any(p_mission_ids)
    and (auth_user_owns_ae(m.ae_id) or auth_user_is_bureau()
         or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))));
$function$;
-- mission_ecarts (hub « à corriger ») : heure du départ = heure effective (vue), au lieu de checkout_time brut.
CREATE OR REPLACE FUNCTION public.mission_ecarts(p_du date, p_au date)
 RETURNS TABLE(genre text, cle text, groupe text, bien_id uuid, bien_code text, bien_nom text, agence text, secteur text, date_ref date, heure time without time zone, mission_id uuid, task_id text, reservation_id uuid, reservation_code text, ae_id uuid, ae_prenom text, echeance timestamp with time zone, en_retard boolean, pourquoi text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
with
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
acc as (
  select id, bien_id, arrival_date, departure_date, owner_stay, guest_name from reservation
  where final_status = 'accepted' and departure_date >= p_du - 20
),
eqs as (select * from equipement_sejours(p_du, p_au)),
dep as (
  select r.id, r.bien_id, r.code, r.platform, r.guest_name, r.arrival_date, r.departure_date, (select hv.heure_depart from reservation_heure_v hv where hv.reservation_id = r.id) as heure_dep_eff, r.booking_date,
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
         r.heure_dep_eff::time as heure,
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
    and not exists (select 1 from sejour_hors_hospitable sh where sh.bien_id = x.bien_id and sh.annule_le is null and sh.date_debut <= x.d and sh.date_fin >= x.d - 14)
),
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
    -- 392 : un passage dédié règle aussi l'installation (mission PowerHouse, tâche Hospitable technique / recouche / check-out)
    and not exists (select 1 from tac t where t.bien_id = s.bien_id and t.type_ph in ('recouche', 'check_out', 'technique')
                      and t.d between s.borne_avant and s.arrivee)
    and not exists (select 1 from manual_missions mm where mm.bien_id = s.bien_id and not coalesce(mm.deleted, false)
                      and coalesce(mm.status, '') not in ('cancelled', 'annule')
                      and (case when mm.date ~ '^\d{4}-\d{2}-\d{2}$' then mm.date::date end) between s.borne_avant and s.arrivee)
),
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
r7 as (
  select 'refacturation_hors_a_decider'::text, 'hors_refact:' || sh.id, 'corriger'::text,
         sh.bien_id, b.code, b.hospitable_name, coalesce(b.agence, 'dcb'), b.secteur, sh.date_fin, null::time,
         null::uuid, null::text, null::uuid, null::text, null::uuid, null::text,
         hub_echeance(sh.date_fin, null),
         'Séjour hors Hospitable « ' || sh.note_blocage || ' » du ' || to_char(sh.date_debut, 'DD/MM/YYYY') || ' au ' || to_char(sh.date_fin, 'DD/MM/YYYY')
           || ' : refacturer le ménage au propriétaire ? Pas encore répondu — rien n''est facturé tant qu''on n''a pas répondu'
  from sejour_hors_hospitable sh join bien b on b.id = sh.bien_id
  where sh.annule_le is null and sh.menage_a_refacturer is null and sh.date_fin between p_du - 30 and p_au
),
tout as (select * from r1 union all select * from r2 union all select * from r3 union all select * from r4 union all select * from r5 union all select * from r6 union all select * from r7)
select t.genre, t.cle, t.groupe, t.bien_id, t.b_code, t.b_nom, t.b_agence, t.b_secteur, t.date_ref, t.heure,
       t.mission_id, t.task_id, t.reservation_id, t.reservation_code, t.ae_id, t.ae_prenom,
       t.echeance, t.echeance < now(), t.pourquoi
from tout t
where not exists (select 1 from mission_journal j where j.ecart_cle = t.cle and j.type = 'ecart_ignore')
$function$;

-- ── 4. Prestations horaires (DCB et Lauïan) ─────────────────────────────────────────────────────────────────────
-- Prix (recherche 17/10/2026, voir mémoire project_portail_options_paiement) : 25 € pour ~2 h, 35-45 € pour 3-4 h ;
-- disponibles seulement si personne n'arrive le jour du départ / ne part le jour de l'arrivée ; commande ≥ 24 h avant.
insert into public.direct_service (agence, cle, type, nom, description, prix_centimes, unite, quantite_max, equipment_ids, actif, ordre, delai_min_h, prix_regle, horaire, horaire_heure, nom_en, nom_es, description_en, description_es, maj_par, maj_le)
select a.agence, s.cle, 'service', s.nom, s.descr, s.prix, 'par_sejour', 1, '{}', true, s.ordre, 24, 'fixe', s.horaire, s.heure, s.nom_en, s.nom_es, s.descr_en, s.descr_es, 'migration 467', now()
from (values ('dcb'), ('lauian')) a(agence)
cross join (values
  ('arrivee_14h', 'Arrivée dès 14 h', 'Arrivée anticipée garantie à partir de 14 h.', 2500, 60, 'arrivee_anticipee', '14:00', 'Check-in from 2 pm', 'Llegada desde las 14 h', 'Guaranteed early check-in from 2 pm.', 'Llegada anticipada garantizada a partir de las 14 h.'),
  ('arrivee_13h', 'Arrivée dès 13 h', 'Arrivée anticipée garantie à partir de 13 h.', 3500, 61, 'arrivee_anticipee', '13:00', 'Check-in from 1 pm', 'Llegada desde las 13 h', 'Guaranteed early check-in from 1 pm.', 'Llegada anticipada garantizada a partir de las 13 h.'),
  ('depart_12h', 'Départ jusqu''à 12 h', 'Départ tardif garanti jusqu''à 12 h.', 2500, 62, 'depart_tardif', '12:00', 'Check-out until noon', 'Salida hasta las 12 h', 'Guaranteed late check-out until noon.', 'Salida tardía garantizada hasta las 12 h.'),
  ('depart_14h', 'Départ jusqu''à 14 h', 'Départ tardif garanti jusqu''à 14 h.', 4500, 63, 'depart_tardif', '14:00', 'Check-out until 2 pm', 'Salida hasta las 14 h', 'Guaranteed late check-out until 2 pm.', 'Salida tardía garantizada hasta las 14 h.')
) s(cle, nom, descr, prix, ordre, horaire, heure, nom_en, nom_es, descr_en, descr_es)
where not exists (select 1 from public.direct_service d where d.agence = a.agence and d.cle = s.cle);
-- Les demandes gratuites d'origine sont remplacées par les prestations payantes (pratique du marché).
update public.direct_service set actif = false, maj_par = 'migration 467', maj_le = now() where cle in ('arrivee_anticipee', 'depart_tardif') and type = 'demande' and actif;

-- ── 5. Champs calculés PostgREST (lecture sans requête de plus) ─────────────────────────────────────────────────
-- reservation?select=checkin_time:sejour_debut,checkout_time:sejour_fin  → instants EFFECTIFS (mêmes noms qu'avant) ;
-- sejour_heure_arrivee / sejour_heure_depart → « HH:MM » (heure de Paris).
create or replace function public.sejour_debut(r public.reservation) returns timestamptz language sql stable as $$ select v.debut from public.reservation_heure_v v where v.reservation_id = r.id $$;
create or replace function public.sejour_fin(r public.reservation) returns timestamptz language sql stable as $$ select v.fin from public.reservation_heure_v v where v.reservation_id = r.id $$;
create or replace function public.sejour_heure_arrivee(r public.reservation) returns text language sql stable as $$ select v.heure_arrivee from public.reservation_heure_v v where v.reservation_id = r.id $$;
create or replace function public.sejour_heure_depart(r public.reservation) returns text language sql stable as $$ select v.heure_depart from public.reservation_heure_v v where v.reservation_id = r.id $$;
revoke all on function public.sejour_debut(public.reservation), public.sejour_fin(public.reservation), public.sejour_heure_arrivee(public.reservation), public.sejour_heure_depart(public.reservation) from anon;
grant execute on function public.sejour_debut(public.reservation), public.sejour_fin(public.reservation), public.sejour_heure_arrivee(public.reservation), public.sejour_heure_depart(public.reservation) to authenticated, service_role;
notify pgrst, 'reload schema';
