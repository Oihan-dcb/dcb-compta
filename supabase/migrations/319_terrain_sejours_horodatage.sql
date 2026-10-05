-- 319 — Contexte séjour pour les AE + horodatage serveur des fiches (05/10/2026, revue portail AE)
-- 1. Les AE (type 'ae') ne lisent pas `reservation` (policy staff) : Ma journée n'avait donc ni
--    « voyageurs attendus aujourd'hui », ni séjour pré-rempli dans les signalements, ni coupure de
--    l'entretien le jour d'une arrivée. RPC limitée aux missions de l'appelant, champs minimum.
-- 2. bien_particularite.updated_at / bien_particularite_lecture.lu_at posés par le SERVEUR (now()) :
--    avec l'horloge du téléphone, une fiche critique pouvait rester « non lue » et bloquer Démarrer.
create or replace function public.terrain_contexte_sejours(p_mission_ids uuid[])
returns table (mission_id uuid, depart_guest text, depart_code text, depart_date date,
               encours_guest text, encours_code text, encours_depart date,
               arrivee_date date, arrivee_checkin text, arrivee_guests integer, arrivee_proprio boolean)
language sql stable security definer set search_path = public as $$
  select m.id,
    rd.guest_name, rd.code, rd.departure_date,
    rc.guest_name, rc.code, rc.departure_date,
    ra.arrival_date, ra.checkin_time, ra.guest_count, ra.owner_stay
  from mission_menage m
  left join reservation rd on rd.id = m.reservation_id
  left join lateral (select r.guest_name, r.code, r.departure_date from reservation r
                      where r.bien_id = m.bien_id and r.final_status = 'accepted'
                        and r.arrival_date <= m.date_mission and r.departure_date > m.date_mission
                      order by r.arrival_date desc limit 1) rc on true
  left join lateral (select r.arrival_date, r.checkin_time, r.guest_count, r.owner_stay from reservation r
                      where r.bien_id = m.bien_id and r.final_status = 'accepted'
                        and r.arrival_date >= m.date_mission and r.arrival_date <= m.date_mission + 21
                      order by r.arrival_date limit 1) ra on true
  where m.id = any(p_mission_ids)
    and (auth_user_owns_ae(m.ae_id) or auth_user_is_bureau()
         or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))));
$$;
revoke all on function public.terrain_contexte_sejours(uuid[]) from public, anon;
grant execute on function public.terrain_contexte_sejours(uuid[]) to authenticated;

create or replace function public._horodatage_serveur_particularite() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_bien_particularite_now on public.bien_particularite;
create trigger trg_bien_particularite_now before insert or update on public.bien_particularite
  for each row execute function public._horodatage_serveur_particularite();

create or replace function public._horodatage_serveur_lecture() returns trigger
language plpgsql as $$ begin new.lu_at := now(); return new; end $$;
drop trigger if exists trg_bien_particularite_lecture_now on public.bien_particularite_lecture;
create trigger trg_bien_particularite_lecture_now before insert or update on public.bien_particularite_lecture
  for each row execute function public._horodatage_serveur_lecture();
