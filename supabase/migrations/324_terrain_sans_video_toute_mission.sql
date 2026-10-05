-- 324 — « Je ne peux pas filmer » possible sur toute mission terminée (pas seulement les régularisations).
-- Motif obligatoire, visible du bureau (PowerHouse 📍 Terrain + Gestion missions). Évite qu'une AE
-- sans batterie / stockage plein reste bloquée à l'étape vidéo (05/10/2026).
create or replace function public.terrain_sans_video(p_mission_id uuid, p_motif text)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  update mission_terrain set video_absente_motif = trim(p_motif), statut = 'terminee', updated_at = now()
   where mission_id = p_mission_id and ended_at is not null and video_media_id is null
  returning * into t;
  if not found then raise exception 'non_autorise'; end if;
  return t;
end $$;
