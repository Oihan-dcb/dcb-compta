-- 375 — Raison de l'absence de position GPS au démarrage / à la fin d'une mission terrain (09/10/2026)
--
-- Constat : missions démarrées sans position (Esteban IBANETA, Kathy PANORAMA) sans qu'on sache
-- pourquoi (refus, délai, GPS indisponible). Le portail AE envoie désormais la raison.
--
--   ok            position obtenue
--   refusee       permission refusée (PERMISSION_DENIED ou état « denied »)
--   delai         délai dépassé (TIMEOUT, même après la 2e tentative en précision normale)
--   indisponible  POSITION_UNAVAILABLE (GPS coupé, intérieur, mode avion…)
--   non_supporte  navigateur sans navigator.geolocation
--   ignoree       l'AE a choisi « Continuer sans position » sans répondre à la demande
--   NULL          ancienne version de l'app (raison inconnue)
--
-- RPC rétrocompatibles : nouveau paramètre p_geo_statut DEFAULT NULL en dernier. Si absent, le
-- serveur met 'ok' quand une position est fournie, sinon laisse NULL (raison inconnue).

alter table public.mission_terrain
  add column if not exists start_geo_statut text,
  add column if not exists end_geo_statut text;

alter table public.mission_terrain drop constraint if exists mission_terrain_start_geo_statut_check;
alter table public.mission_terrain add constraint mission_terrain_start_geo_statut_check
  check (start_geo_statut is null or start_geo_statut in ('ok','refusee','delai','indisponible','non_supporte','ignoree'));
alter table public.mission_terrain drop constraint if exists mission_terrain_end_geo_statut_check;
alter table public.mission_terrain add constraint mission_terrain_end_geo_statut_check
  check (end_geo_statut is null or end_geo_statut in ('ok','refusee','delai','indisponible','non_supporte','ignoree'));

-- Historique : position présente = ok
update public.mission_terrain set start_geo_statut = 'ok' where start_lat is not null and start_geo_statut is null;
update public.mission_terrain set end_geo_statut = 'ok' where end_lat is not null and end_geo_statut is null;

create or replace function public._terrain_geo_statut(p_lat double precision, p_statut text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_lat is not null then 'ok'
    when p_statut in ('refusee','delai','indisponible','non_supporte','ignoree') then p_statut
    else null end
$$;

-- ── terrain_demarrer : + p_geo_statut ──────────────────────────────────────
drop function if exists public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text);
create or replace function public.terrain_demarrer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_etat_arrivee text default null, p_type text default 'menage',
  p_geo_statut text default null
) returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; b bien;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into b from bien where id = m.bien_id;
  insert into mission_terrain (mission_id, ae_id, bien_id, start_lat, start_lng, start_acc_m, etat_arrivee, type_terrain, start_distance_m, start_geo_statut)
  values (m.id, m.ae_id, m.bien_id, p_lat, p_lng, p_acc, p_etat_arrivee, coalesce(p_type, 'menage'), distance_m(p_lat, p_lng, b.geo_lat, b.geo_lng),
          _terrain_geo_statut(p_lat, p_geo_statut))
  on conflict (mission_id) do nothing;
  select * into t from mission_terrain where mission_id = m.id;
  return t;
end $$;
revoke all on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text, text) from public, anon;
grant execute on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text, text) to authenticated, service_role;

-- ── terrain_terminer : + p_geo_statut ──────────────────────────────────────
drop function if exists public.terrain_terminer(uuid, double precision, double precision, double precision);
create or replace function public.terrain_terminer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_geo_statut text default null
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
    end_geo_statut = _terrain_geo_statut(p_lat, p_geo_statut),
    duree_minutes = greatest(5, (round(extract(epoch from (now() - started_at)) / 60 / 5) * 5)::int),
    statut = case when video_media_id is not null then 'terminee' else 'video_attendue' end,
    updated_at = now()
  where mission_id = p_mission_id
  returning * into t;
  return t;
end $$;
revoke all on function public.terrain_terminer(uuid, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.terrain_terminer(uuid, double precision, double precision, double precision, text) to authenticated, service_role;

-- ── Refus répétés par AE (30 derniers jours) — lu par PowerHouse (bureau) ──
-- security_invoker : les RLS de mission_terrain s'appliquent (bureau = tout, AE = soi).
create or replace view public.terrain_geo_refus_ae with (security_invoker = true) as
select ae_id,
       count(*) filter (where start_geo_statut is not null or end_geo_statut is not null)       as missions_renseignees,
       count(*) filter (where 'refusee' in (start_geo_statut, end_geo_statut))                    as missions_refus,
       count(*) filter (where start_geo_statut in ('delai','indisponible') or end_geo_statut in ('delai','indisponible')) as missions_gps_ko,
       max(started_at) filter (where 'refusee' in (start_geo_statut, end_geo_statut))             as dernier_refus
  from public.mission_terrain
 where started_at >= now() - interval '30 days'
 group by ae_id;
grant select on public.terrain_geo_refus_ae to authenticated, service_role;
revoke all on public.terrain_geo_refus_ae from anon;
revoke all on function public._terrain_geo_statut(double precision, text) from anon;

notify pgrst, 'reload schema';
