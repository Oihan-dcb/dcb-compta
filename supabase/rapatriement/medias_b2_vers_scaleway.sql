-- Rapatriement FR — médias de messagerie Backblaze B2 (Amsterdam) → Scaleway Object Storage (Paris).
-- PRÉPARÉ le 17/10/2026, NON APPLIQUÉ. À copier dans supabase/migrations/ avec le prochain numéro libre
-- au moment de la bascule (cf. bascule_semaine_pro.md, étape « Stockage médias »), APRÈS la copie des objets
-- (scripts/copie-medias-b2-vers-scaleway.js --executer puis --verifier dans dcb-planning).
--
-- Remplacer partout __NOUVELLE_BASE__ par l'adresse publique du bucket Scaleway, SANS « / » final, ex. :
--   https://s3.fr-par.scw.cloud/dcb-chat-media-fr
-- (= MEDIA_S3_PUBLIC_BASE posée sur le projet Vercel powerhouse, ou `${MEDIA_S3_ENDPOINT}/${MEDIA_S3_BUCKET}`).
--
-- Constat du 17/10/2026 (lecture seule) : 391 lignes chat_messages.attachment_url, 391 media_library.attachment_url,
-- 101 video_annotation.image_url pointent vers B2. Aucune autre colonne trouvée (recherche sur les colonnes
-- url/media/photo/video/image/fichier/…) — la requête 0 ci-dessous refait une recherche complète avant d'agir.

-- ── 0. Vérification préalable (lecture seule) : toutes les colonnes texte/json qui contiennent l'adresse B2 ──
-- do $$ declare r record; n bigint; begin
--   for r in select table_name, column_name from information_schema.columns c
--            join information_schema.tables t using (table_schema, table_name)
--            where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
--              and c.data_type in ('text','character varying','jsonb','json','ARRAY') loop
--     execute format('select count(*) from public.%I where %I::text like ''%%backblazeb2.com%%''', r.table_name, r.column_name) into n;
--     if n > 0 then raise notice '% . % : %', r.table_name, r.column_name, n; end if;
--   end loop; end $$;

-- ── 1. La fonction d'annotation vidéo accepte l'ancien ET le nouveau préfixe ──
-- (copie fidèle de la définition en production le 17/10/2026, seule la ligne du test d'URL change)
create or replace function public.terrain_envoyer_annotations(p_mission_id uuid, p_media_id uuid, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m mission_menage; v_room uuid; v_bien text; v_user uuid; it jsonb; v_t numeric; v_txt text; v_img text; v_type text;
        n int := 0; v_lot uuid := gen_random_uuid(); v_msg uuid; nb jsonb;
begin
  m := _terrain_check_bureau(p_mission_id);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'aucune_annotation'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'trop_annotations'; end if;
  v_room := _terrain_room_staff(m.ae_id);
  if v_room is null then raise exception 'conversation_staff_introuvable'; end if;
  select ae_user_id into v_user from auto_entrepreneur where id = m.ae_id;
  select coalesce(code, hospitable_name) into v_bien from bien where id = m.bien_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_t := greatest(0, coalesce((it->>'t')::numeric, 0));
    v_txt := trim(coalesce(it->>'texte', ''));
    v_img := nullif(trim(coalesce(it->>'image_url', '')), '');
    v_type := coalesce(nullif(it->>'type', ''), 'corriger');
    if v_type not in ('bravo', 'corriger', 'question') then raise exception 'type_invalide'; end if;
    if length(v_txt) < 2 and v_img is null then continue; end if;
    if v_img is not null
       and v_img !~ '^https://s3\.eu-central-003\.backblazeb2\.com/dcb-chat-media/chat-media/'
       and left(v_img, length('__NOUVELLE_BASE__/chat-media/')) <> '__NOUVELLE_BASE__/chat-media/' then
      raise exception 'image_non_autorisee';
    end if;
    insert into video_annotation (mission_id, media_id, t_secondes, texte, image_url, type, lot_id, created_by)
    values (m.id, p_media_id, v_t, v_txt, v_img, v_type, v_lot, auth.uid());
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'aucune_annotation'; end if;
  select jsonb_object_agg(type, c) into nb from (select type, count(*) c from video_annotation where lot_id = v_lot group by type) x;
  insert into chat_messages (room_id, sender_id, body)
  values (v_room, _chat_sender(), 'VFB::' || jsonb_build_object('lot_id', v_lot, 'mission_id', m.id, 'bien', v_bien,
          'date', m.date_mission, 'n', n, 'types', nb)::text)
  returning id into v_msg;
  update video_annotation set message_id = v_msg where lot_id = v_lot;
  return jsonb_build_object('room_id', v_room, 'ae_user_id', v_user, 'envoyees', n, 'lot_id', v_lot);
end $function$;

-- ── 2. Réécriture des adresses déjà enregistrées (même clé d'objet, seule la base change) ──
-- Sauvegarde d'abord (retour arrière = remettre ces valeurs) :
create table if not exists public.bkp_medias_b2_urls as
  select 'chat_messages'::text as t, id::text as id, attachment_url as url from public.chat_messages where attachment_url like 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/%'
  union all
  select 'media_library', id::text, attachment_url from public.media_library where attachment_url like 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/%'
  union all
  select 'video_annotation', id::text, image_url from public.video_annotation where image_url like 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/%';
alter table public.bkp_medias_b2_urls enable row level security; -- pas d'accès par l'API publique

update public.chat_messages
   set attachment_url = replace(attachment_url, 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/', '__NOUVELLE_BASE__/')
 where attachment_url like 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/%';
update public.media_library
   set attachment_url = replace(attachment_url, 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/', '__NOUVELLE_BASE__/')
 where attachment_url like 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/%';
update public.video_annotation
   set image_url = replace(image_url, 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/', '__NOUVELLE_BASE__/')
 where image_url like 'https://s3.eu-central-003.backblazeb2.com/dcb-chat-media/%';

-- ── Retour arrière (si besoin) ──
-- update public.chat_messages c set attachment_url = b.url from public.bkp_medias_b2_urls b where b.t = 'chat_messages' and b.id = c.id::text;
-- update public.media_library c set attachment_url = b.url from public.bkp_medias_b2_urls b where b.t = 'media_library' and b.id = c.id::text;
-- update public.video_annotation c set image_url = b.url from public.bkp_medias_b2_urls b where b.t = 'video_annotation' and b.id = c.id::text;
-- (la fonction de l'étape 1 accepte les deux préfixes : pas besoin de la remettre)
