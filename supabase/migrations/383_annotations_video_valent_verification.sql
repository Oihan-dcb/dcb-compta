-- 383 — Des annotations vidéo envoyées valent vérification (10/10/2026, demande d'Oïhan).
-- Symptôme : des missions dont Oïhan avait regardé la vidéo et envoyé des annotations
-- (🎬 bravo / corriger / question, video_annotation) restaient « à vérifier » dans le hub des
-- tâches : la vue mission_hub_v ne lit que mission_terrain.controle_statut, que seuls les boutons
-- ✓ / ✕ remplissaient. Annoter une vidéo, c'est l'avoir vérifiée.
-- Règle : la première annotation d'une mission sans contrôle la marque vérifiée (ok), au nom et à
-- l'heure de l'annotateur. Un « À reprendre » se décide toujours avec le bouton ✕ ; un contrôle déjà
-- posé (ok ou à reprendre) n'est jamais écrasé.
create or replace function public.video_annotation_vaut_verification()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update mission_terrain
     set controle_statut = 'ok',
         controle_note   = 'Vérifiée par annotations vidéo',
         controle_par    = new.created_by,
         controle_at     = coalesce(new.created_at, now()),
         updated_at      = now()
   where mission_id = new.mission_id
     and controle_statut is null;
  return new;
end $$;
revoke all on function public.video_annotation_vaut_verification() from public, anon, authenticated;

drop trigger if exists trg_video_annotation_vaut_verification on public.video_annotation;
create trigger trg_video_annotation_vaut_verification
  after insert on public.video_annotation
  for each row execute function public.video_annotation_vaut_verification();

-- Même règle appliquée aux annotations déjà envoyées (première annotation de chaque mission).
update mission_terrain t
   set controle_statut = 'ok',
       controle_note   = 'Vérifiée par annotations vidéo',
       controle_par    = a.created_by,
       controle_at     = a.created_at,
       updated_at      = now()
  from (select distinct on (mission_id) mission_id, created_by, created_at
          from video_annotation order by mission_id, created_at) a
 where a.mission_id = t.mission_id
   and t.controle_statut is null;
