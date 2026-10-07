-- 340 — Vidéo ajoutée APRÈS une déclaration « sans vidéo » (bouton « Ajouter la vidéo maintenant » du
-- portail AE, 07/10/2026) : le motif d'absence restait posé → PowerHouse 📍 Terrain affichait à la fois
-- « 🎬 voir la vidéo » et l'alerte « 🎥 sans vidéo : video trop lourde » (602, Camille).
-- Rattacher une vidéo efface désormais le motif ; les missions déjà dans ce cas sont remises d'aplomb.
create or replace function public.terrain_attacher_video(p_mission_id uuid, p_media_id uuid)
 returns mission_terrain
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m mission_menage; t mission_terrain; med media_library;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = m.id;
  if not found then raise exception 'mission_non_demarree'; end if;
  select * into med from media_library where id = p_media_id;
  if not found then raise exception 'media_introuvable'; end if;
  if med.sender_id <> auth.uid() or med.subject not in ('apres_menage', 'probleme_technique') or med.bien_id is distinct from m.bien_id then
    raise exception 'media_non_conforme';
  end if;
  if med.mission_id is not null and med.mission_id <> m.id then raise exception 'media_deja_rattache'; end if;
  if med.created_at < t.started_at then raise exception 'media_anterieur_au_demarrage'; end if;
  update media_library set mission_id = m.id where id = p_media_id and mission_id is null;
  update mission_terrain set
    video_media_id = p_media_id, video_at = now(),
    video_absente_motif = null,
    statut = case when ended_at is not null then 'terminee' else statut end,
    updated_at = now()
  where mission_id = m.id
  returning * into t;
  return t;
end $function$;

update public.mission_terrain set video_absente_motif = null, updated_at = now()
 where video_media_id is not null and video_absente_motif is not null;
