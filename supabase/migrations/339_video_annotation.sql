-- 339 — Annotations horodatées sur la vidéo d'une mission (PowerHouse 📍 Terrain, 07/10/2026, Oïhan :
-- « faire des annotations directement sur la vidéo, timestampées au moment où j'écris (pause), comme un
-- screenshot, renvoyées à Camille pour amélioration »).
-- Le bureau capture l'image (dessin stylo possible), écrit un commentaire, puis envoie le lot : un message
-- par annotation dans la conversation du staff (capture en pièce jointe), historique gardé ici.
create table if not exists public.video_annotation (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.mission_menage(id) on delete cascade,
  media_id uuid references public.media_library(id) on delete set null,
  t_secondes numeric not null check (t_secondes >= 0),
  texte text not null,
  image_url text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  message_id uuid
);
create index if not exists video_annotation_mission_idx on public.video_annotation (mission_id);
alter table public.video_annotation enable row level security;
-- Lecture : bureau / staff du secteur (mêmes règles que le contrôle). Écriture uniquement via la RPC.
drop policy if exists video_annotation_select on public.video_annotation;
create policy video_annotation_select on public.video_annotation for select to authenticated
  using (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null
    or mission_id in (select id from mission_menage where bien_id in (select my_scoped_bien_ids())))));

-- p_items : [{ "t": 42.3, "texte": "…", "image_url": "https://…b2…" }]
-- Renvoie { room_id, ae_user_id, envoyees } (ae_user_id → push côté API).
create or replace function public.terrain_envoyer_annotations(p_mission_id uuid, p_media_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m mission_menage; v_room uuid; v_bien text; v_user uuid; it jsonb; v_t numeric; v_txt text; v_img text;
        v_msg uuid; n int := 0; v_ts text;
begin
  m := _terrain_check_bureau(p_mission_id);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'aucune_annotation'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'trop_annotations'; end if;
  v_room := _terrain_room_staff(m.ae_id);
  if v_room is null then raise exception 'conversation_staff_introuvable'; end if;
  select ae_user_id into v_user from auto_entrepreneur where id = m.ae_id;
  select coalesce(code, hospitable_name) into v_bien from bien where id = m.bien_id;
  for it in select * from jsonb_array_elements(p_items) order by (value->>'t')::numeric loop
    v_t := greatest(0, coalesce((it->>'t')::numeric, 0));
    v_txt := trim(coalesce(it->>'texte', ''));
    v_img := nullif(trim(coalesce(it->>'image_url', '')), '');
    if length(v_txt) < 2 and v_img is null then continue; end if;
    -- Pièce jointe limitée à notre bucket B2 (pas d'URL arbitraire dans la messagerie du staff).
    if v_img is not null and v_img !~ '^https://s3\.eu-central-003\.backblazeb2\.com/dcb-chat-media/chat-media/' then
      raise exception 'image_non_autorisee';
    end if;
    v_ts := to_char(make_interval(secs => floor(v_t)), 'FMMI:SS');
    insert into chat_messages (room_id, sender_id, body, attachment_url)
    values (v_room, auth.uid(),
      '🎬 ' || coalesce(v_bien, 'Mission') || ' (' || to_char(m.date_mission, 'DD/MM') || ') — ⏱ ' || v_ts
        || case when length(v_txt) >= 2 then ' — ' || v_txt else '' end,
      v_img)
    returning id into v_msg;
    insert into video_annotation (mission_id, media_id, t_secondes, texte, image_url, message_id)
    values (m.id, p_media_id, v_t, v_txt, v_img, v_msg);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'aucune_annotation'; end if;
  return jsonb_build_object('room_id', v_room, 'ae_user_id', v_user, 'envoyees', n);
end $$;
revoke all on function public.terrain_envoyer_annotations(uuid, uuid, jsonb) from public, anon;
grant execute on function public.terrain_envoyer_annotations(uuid, uuid, jsonb) to authenticated;
