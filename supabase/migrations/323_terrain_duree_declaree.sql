-- 323 — L'AE DÉCLARE son temps ; le chrono devient un contrôle caché (Oïhan 05/10/2026)
-- « Elle rentre ses heures, sauf que moi de mon côté (PowerHouse) je vois ce qu'elle a rentré et la
-- réalité du chrono à côté. » → mission_terrain.duree_declaree_minutes (saisie en fin de mission, sans
-- pré-remplissage, chrono jamais montré à l'AE) = base de paie (plafonnée au forfait, extras au-delà) ;
-- duree_minutes (chrono serveur) reste le contrôle, affiché côte à côte dans Gestion / Terrain.
alter table public.mission_terrain add column if not exists duree_declaree_minutes integer;

create or replace function public.terrain_declarer_duree(p_mission_id uuid, p_minutes integer)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if p_minutes is null or p_minutes < 5 or p_minutes > 16 * 60 then raise exception 'duree_invalide'; end if;
  update mission_terrain set duree_declaree_minutes = (round(p_minutes / 5.0) * 5)::int, updated_at = now()
   where mission_id = p_mission_id and ended_at is not null and duree_appliquee_at is null
  returning * into t;
  if not found then raise exception 'mission_non_terminee_ou_deja_appliquee'; end if;
  return t;
end $$;
revoke all on function public.terrain_declarer_duree(uuid, integer) from public, anon;
grant execute on function public.terrain_declarer_duree(uuid, integer) to authenticated;

-- terrain_ajuster_extras_forfait : le total de référence devient la durée DÉCLARÉE (repli chrono).
-- (corps identique à la 320, total := coalesce(duree_declaree_minutes, duree_corrigee_minutes, duree_minutes, 0))
