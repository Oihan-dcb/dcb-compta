-- 341 — Retours vidéo pédagogiques (07/10/2026, Oïhan) + expéditeur « Inconnu » dans la messagerie.
--
-- 1. Les comptes PowerHouse (staff_users) n'ont pas de fiche AE → la messagerie du portail (noms résolus
--    via ae_annuaire.ae_user_id) affichait « Inconnu » pour les messages envoyés depuis 📍 Terrain.
--    Lien explicite staff_users.ae_user_id (emails différents : oihan@dcb ≠ oihan64@gmail, idem Laura)
--    + _chat_sender() : identité de messagerie de l'appelant. Messages déjà postés corrigés.
-- 2. Annotations typées (👍 bravo / 🔧 à corriger / ❓ question), envoyées par LOT : UN message « VFB:: »
--    dans la conversation, rendu par le portail en cartes qui défilent ; le staff confirme chaque carte
--    (merci / compris / réponse obligatoire à une question). Vu + réponses remontent dans PowerHouse ;
--    une réponse à une question est aussi postée dans la conversation.
alter table public.staff_users add column if not exists ae_user_id uuid;
update public.staff_users su set ae_user_id = a.ae_user_id
  from public.auto_entrepreneur a
 where su.ae_user_id is null and a.actif and (
       (su.email = 'oihan@destinationcotebasque.com' and a.email = 'oihan64@gmail.com')
    or (su.email = 'laura@destinationcotebasque.com' and a.email = 'lauracoursan@hotmail.fr'));

create or replace function public._chat_sender()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((select ae_user_id from staff_users where auth_user_id = auth.uid() and ae_user_id is not null limit 1), auth.uid());
$$;
revoke all on function public._chat_sender() from public, anon;
grant execute on function public._chat_sender() to authenticated;

-- Correction limitée aux 6 annotations du 07/10 (Oïhan) : les 21 messages de mai du compte staff de
-- Laura sont de vraies conversations où ce compte est membre — on n'y touche pas.
update public.chat_messages cm set sender_id = su.ae_user_id
  from public.staff_users su
 where cm.sender_id = su.auth_user_id and su.ae_user_id is not null
   and su.email = 'oihan@destinationcotebasque.com' and cm.body like '🎬 %' and cm.created_at >= '2026-10-07';

create or replace function public.terrain_message_staff(p_mission_id uuid, p_texte text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m mission_menage; v_room uuid; v_bien text; v_id uuid;
begin
  m := _terrain_check_bureau(p_mission_id);
  if length(trim(coalesce(p_texte, ''))) < 2 then raise exception 'message_vide'; end if;
  v_room := _terrain_room_staff(m.ae_id);
  if v_room is null then raise exception 'conversation_staff_introuvable'; end if;
  select coalesce(code, hospitable_name) into v_bien from bien where id = m.bien_id;
  insert into chat_messages (room_id, sender_id, body)
  values (v_room, _chat_sender(), '📍 ' || coalesce(v_bien, 'Mission') || ' (' || to_char(m.date_mission, 'DD/MM') || ') — ' || trim(p_texte))
  returning id into v_id;
  return v_id;
end $$;

alter table public.video_annotation add column if not exists type text not null default 'corriger'
  check (type in ('bravo', 'corriger', 'question'));
alter table public.video_annotation add column if not exists lot_id uuid;
alter table public.video_annotation add column if not exists vu_at timestamptz;
alter table public.video_annotation add column if not exists reponse text;
create index if not exists video_annotation_lot_idx on public.video_annotation (lot_id);

-- p_items : [{ "t": 42.3, "type": "corriger", "texte": "…", "image_url": "https://…b2…" }]
create or replace function public.terrain_envoyer_annotations(p_mission_id uuid, p_media_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    if v_img is not null and v_img !~ '^https://s3\.eu-central-003\.backblazeb2\.com/dcb-chat-media/chat-media/' then
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
end $$;

-- Cartes d'un lot : le staff de la mission ou le bureau.
create or replace function public.video_feedback_lot(p_lot uuid)
returns table (id uuid, t_secondes numeric, type text, texte text, image_url text, vu_at timestamptz, reponse text,
               video_url text, mission_id uuid, bien text, date_mission date, peut_confirmer boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_mission uuid; v_ae_user uuid;
begin
  select a.mission_id into v_mission from video_annotation a where a.lot_id = p_lot limit 1;
  if v_mission is null then return; end if;
  select ae.ae_user_id into v_ae_user from mission_menage mm join auto_entrepreneur ae on ae.id = mm.ae_id where mm.id = v_mission;
  if not (auth.uid() = v_ae_user or auth_user_is_bureau() or _chat_sender() = v_ae_user) then raise exception 'acces_refuse'; end if;
  return query
    select a.id, a.t_secondes, a.type, a.texte, a.image_url, a.vu_at, a.reponse, ml.attachment_url, mm.id,
           coalesce(b.code, b.hospitable_name), mm.date_mission, auth.uid() = v_ae_user
      from video_annotation a
      join mission_menage mm on mm.id = a.mission_id
      left join bien b on b.id = mm.bien_id
      left join media_library ml on ml.id = a.media_id
     where a.lot_id = p_lot
     order by a.t_secondes;
end $$;
revoke all on function public.video_feedback_lot(uuid) from public, anon;
grant execute on function public.video_feedback_lot(uuid) to authenticated;

-- Confirmation d'une carte par le staff concerné. Question → réponse obligatoire, postée aussi dans la conversation.
create or replace function public.video_feedback_confirmer(p_annotation_id uuid, p_reponse text default null)
returns video_annotation language plpgsql security definer set search_path = public as $$
declare a video_annotation; v_ae_user uuid; v_room uuid; v_bien text; v_rep text := nullif(trim(coalesce(p_reponse, '')), '');
begin
  select * into a from video_annotation where id = p_annotation_id;
  if not found then raise exception 'annotation_introuvable'; end if;
  select ae.ae_user_id into v_ae_user from mission_menage mm join auto_entrepreneur ae on ae.id = mm.ae_id where mm.id = a.mission_id;
  if auth.uid() is distinct from v_ae_user then raise exception 'acces_refuse'; end if;
  if a.type = 'question' and (v_rep is null or length(v_rep) < 2) then raise exception 'reponse_obligatoire'; end if;
  update video_annotation set vu_at = coalesce(vu_at, now()), reponse = coalesce(v_rep, reponse) where id = a.id returning * into a;
  if a.type = 'question' and v_rep is not null then
    select room_id into v_room from chat_messages where id = a.message_id;
    select coalesce(b.code, b.hospitable_name) into v_bien from mission_menage mm left join bien b on b.id = mm.bien_id where mm.id = a.mission_id;
    if v_room is not null then
      insert into chat_messages (room_id, sender_id, body)
      values (v_room, auth.uid(), '↩️ ' || coalesce(v_bien, '') || ' ⏱ ' || to_char(make_interval(secs => floor(a.t_secondes)), 'FMMI:SS')
              || ' « ' || a.texte || ' » — ' || v_rep);
    end if;
  end if;
  return a;
end $$;
revoke all on function public.video_feedback_confirmer(uuid, text) from public, anon;
grant execute on function public.video_feedback_confirmer(uuid, text) to authenticated;

-- Retours à confirmer du staff connecté (bandeau Ma journée) + dernier lot par bien (« revoir mon récap »).
create or replace function public.video_feedback_mes_lots()
returns table (lot_id uuid, mission_id uuid, bien_id uuid, bien text, date_mission date, n int, a_confirmer int, room_id uuid)
language sql stable security definer set search_path = public as $$
  select a.lot_id, mm.id, mm.bien_id, coalesce(b.code, b.hospitable_name), mm.date_mission,
         count(*)::int, count(*) filter (where a.vu_at is null)::int, max(cm.room_id::text)::uuid
    from video_annotation a
    join mission_menage mm on mm.id = a.mission_id
    join auto_entrepreneur ae on ae.id = mm.ae_id and ae.ae_user_id = auth.uid()
    left join bien b on b.id = mm.bien_id
    left join chat_messages cm on cm.id = a.message_id
   where a.lot_id is not null
   group by a.lot_id, mm.id, mm.bien_id, b.code, b.hospitable_name, mm.date_mission
   order by mm.date_mission desc;
$$;
revoke all on function public.video_feedback_mes_lots() from public, anon;
grant execute on function public.video_feedback_mes_lots() to authenticated;
