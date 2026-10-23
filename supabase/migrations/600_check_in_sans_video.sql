-- 600 — Check-in : la vidéo n'est pas obligatoire (règle Oïhan, 23/10/2026).
-- Avant : terminer un check-in sans vidéo le laissait en « video_attendue » (relances, mission « à terminer »),
-- et le hub affichait l'anomalie « pas de vidéo ». Désormais un check-in terminé est « terminee » directement,
-- et le hub ne compte pas l'absence de vidéo d'un check-in. Les autres types ne changent pas.
-- Remplacement ciblé dans les définitions existantes (idempotent : rien ne change si déjà appliqué).
do $$
declare f text; def text; nouv text;
begin
  foreach f in array array['terrain_terminer', 'terrain_terminer_oubli', 'terrain_declarer'] loop
    for def in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = f loop
      nouv := replace(def,
        'statut = case when video_media_id is not null then ''terminee'' else ''video_attendue'' end',
        'statut = case when video_media_id is not null or type_terrain = ''check_in'' then ''terminee'' else ''video_attendue'' end');
      if nouv <> def then execute nouv; end if;
    end loop;
  end loop;
  select pg_get_functiondef('public.mission_hub_periode(date,date,timestamp with time zone)'::regprocedure) into def;
  nouv := replace(def, 'case when r.si_sans_video and base.video_media_id is null',
                       'case when r.si_sans_video and base.video_media_id is null and coalesce(base.type_terrain, '''') <> ''check_in''');
  if nouv <> def then execute nouv; end if;
end $$;

-- Check-ins déjà terminés restés « vidéo attendue » : même règle appliquée aux données existantes.
update public.mission_terrain set statut = 'terminee', updated_at = now()
 where type_terrain = 'check_in' and statut = 'video_attendue' and ended_at is not null;
