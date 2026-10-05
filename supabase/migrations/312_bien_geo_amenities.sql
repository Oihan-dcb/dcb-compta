-- 312 — Coordonnées GPS + équipements Hospitable sur bien, distance au bien au début/fin de mission (05/10/2026)
-- Hospitable fournit address.coordinates (latitude/longitude) et amenities (dishwasher, washer, bbq,
-- patio…) : recopiés par dcb-compta api/sync-biens.js (cron nuit). Plus fiable qu'un géocodage.
--   - mission_terrain.start/end_distance_m : distance entre la position ponctuelle de l'AE et le bien
--     (alerte « hors zone » côté PowerHouse, jamais bloquant) ;
--   - entretien_suggestions : équipements détectés aussi via les amenities Hospitable.
alter table public.bien add column if not exists geo_lat double precision;
alter table public.bien add column if not exists geo_lng double precision;
alter table public.bien add column if not exists hospitable_amenities text[];
alter table public.mission_terrain add column if not exists start_distance_m integer;
alter table public.mission_terrain add column if not exists end_distance_m integer;

create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns integer language sql immutable as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null else
    round(2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::int end;
$$;

drop function if exists public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text);
create or replace function public.terrain_demarrer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_etat_arrivee text default null, p_type text default 'menage'
) returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; b bien;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into b from bien where id = m.bien_id;
  insert into mission_terrain (mission_id, ae_id, bien_id, start_lat, start_lng, start_acc_m, etat_arrivee, type_terrain, start_distance_m)
  values (m.id, m.ae_id, m.bien_id, p_lat, p_lng, p_acc, p_etat_arrivee, coalesce(p_type, 'menage'), distance_m(p_lat, p_lng, b.geo_lat, b.geo_lng))
  on conflict (mission_id) do nothing;
  select * into t from mission_terrain where mission_id = m.id;
  return t;
end $$;
revoke all on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text) from public, anon;
grant execute on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text) to authenticated;

create or replace function public.terrain_terminer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null
) returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain; b bien;
begin
  perform _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = p_mission_id for update;
  if not found then raise exception 'mission_non_demarree'; end if;
  if t.ended_at is not null then return t; end if;
  select * into b from bien where id = t.bien_id;
  update mission_terrain set
    ended_at = now(),
    end_lat = p_lat, end_lng = p_lng, end_acc_m = p_acc,
    end_distance_m = distance_m(p_lat, p_lng, b.geo_lat, b.geo_lng),
    duree_minutes = greatest(5, (round(extract(epoch from (now() - started_at)) / 60 / 5) * 5)::int),
    statut = case when video_media_id is not null then 'terminee' else 'video_attendue' end,
    updated_at = now()
  where mission_id = p_mission_id
  returning * into t;
  return t;
end $$;

create or replace function public.entretien_suggestions(p_bien_id uuid)
returns table (entretien_type_id uuid, nom text, icone text, equipement text, detecte boolean, deja_plan boolean, plan_actif boolean)
language sql stable security definer set search_path = public as $$
  with tb as (select id from bien_toolbox where bien_id = p_bien_id and archived_at is null limit 1),
  am as (select coalesce(hospitable_amenities, '{}'::text[]) a from bien where id = p_bien_id),
  eq as (
    select 'lave_linge'::text e where exists (select 1 from bien_faq_pratique f where f.bien_id = p_bien_id and f.lave_linge)
       or array['washer'] <@ (select a from am)
       or exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = (select id from tb) and c.actif and ci.nom ilike 'machine à laver%')
    union select 'lave_vaisselle' where array['dishwasher'] <@ (select a from am)
       or exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = (select id from tb) and c.actif and ci.nom ilike 'lave-vaisselle')
    union select 'barbecue' where (select a from am) && array['bbq', 'outdoor_kitchen', 'barbeque_utensils']
    union select 'exterieur' where (select a from am) && array['patio', 'garden', 'backyard', 'outdoor_seating', 'alfresco_dining']
  )
  select t.id, t.nom, t.icone, t.equipement,
         (t.equipement is null or t.equipement in (select e from eq)),
         pl.id is not null, coalesce(pl.actif, false)
    from entretien_type t
    left join bien_entretien_plan pl on pl.entretien_type_id = t.id and pl.bien_id = p_bien_id
   where t.actif and auth_user_is_internal()
   order by t.ordre;
$$;
