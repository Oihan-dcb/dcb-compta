-- 303 — Type de mission terrain choisi par l'AE au démarrage (05/10/2026).
-- Hospitable range sous « Maintenance » des choses très différentes (recouches surtout, demandes
-- de ménage ponctuelles, interventions techniques) : l'AE confirme d'un tap avant de démarrer,
-- pré-sélection déduite du titre / de la note de la tâche (MaJournee.jsx devinerTypeTerrain).
-- Cleaning / Check-out → menage, Check-in → check_in (vérification), sans question.
alter table public.mission_terrain add column if not exists type_terrain text not null default 'menage'
  check (type_terrain in ('menage', 'check_in', 'recouche', 'demande_menage', 'technique'));

drop function if exists public.terrain_demarrer(uuid, double precision, double precision, double precision, text);
create or replace function public.terrain_demarrer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_etat_arrivee text default null, p_type text default 'menage'
) returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain;
begin
  m := _terrain_mission_check(p_mission_id);
  insert into mission_terrain (mission_id, ae_id, bien_id, start_lat, start_lng, start_acc_m, etat_arrivee, type_terrain)
  values (m.id, m.ae_id, m.bien_id, p_lat, p_lng, p_acc, p_etat_arrivee, coalesce(p_type, 'menage'))
  on conflict (mission_id) do nothing;
  select * into t from mission_terrain where mission_id = m.id;
  return t;
end $$;
revoke all on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text) from public, anon;
grant execute on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text, text) to authenticated;

-- Mission technique : la vidéo de fin est un média « probleme_technique » (pas un « après ménage »,
-- qui alimente bien_pret_jour). terrain_attacher_video accepte les deux sujets.
create or replace function public.terrain_attacher_video(p_mission_id uuid, p_media_id uuid)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; med media_library;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into med from media_library where id = p_media_id;
  if not found then raise exception 'media_introuvable'; end if;
  if med.sender_id <> auth.uid() or med.subject not in ('apres_menage', 'probleme_technique') or med.bien_id is distinct from m.bien_id then
    raise exception 'media_non_conforme';
  end if;
  update media_library set mission_id = m.id where id = p_media_id and mission_id is null;
  update mission_terrain set
    video_media_id = p_media_id, video_at = now(),
    statut = case when ended_at is not null then 'terminee' else statut end,
    updated_at = now()
  where mission_id = m.id
  returning * into t;
  if not found then raise exception 'mission_non_demarree'; end if;
  return t;
end $$;
