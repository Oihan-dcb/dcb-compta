-- 366 — Les messages automatiques terrain partaient dans la conversation d'un AUTRE staff quand la mission était
-- assignée à un manager (10/10/2026 : check-in MIRAMARVEL de Laura marqué fait → « ✅ MIRAMARVEL ok » posté dans la
-- conversation de Kathy). Cause : la salle était choisie parmi TOUTES les staff_room dont la personne est membre
-- (un manager l'est de toutes), le tri par nom n'étant qu'une préférence. Désormais : uniquement la salle staff
-- DONT la personne est le staff (membre non-manager, nom de salle = son prénom) ; aucune → aucun message.
create or replace function public.terrain_salle_du_staff(p_ae_id uuid)
 returns uuid language sql stable security definer set search_path to 'public' as $$
  select r.id
    from auto_entrepreneur a
    join chat_room_members cm on cm.user_id = a.ae_user_id
    join chat_rooms r on r.id = cm.room_id and r.type = 'staff_room'
   where a.id = p_ae_id and a.ae_user_id is not null and not coalesce(a.is_chat_manager, false)
     and r.name ilike coalesce(nullif(a.prenom, ''), '§') || '%'
   order by r.created_at
   limit 1
$$;
revoke all on function public.terrain_salle_du_staff(uuid) from public, anon, authenticated;

create or replace function public.terrain_poster(p_mission_id uuid, p_corps text, p_piece text default null)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare m mission_menage; a auto_entrepreneur; v_room uuid;
begin
  select * into m from mission_menage where id = p_mission_id;
  if m.id is null then return; end if;
  select * into a from auto_entrepreneur where id = m.ae_id;
  if a.ae_user_id is null then return; end if;
  v_room := terrain_salle_du_staff(a.id);
  if v_room is null then return; end if;
  insert into chat_messages (room_id, sender_id, body, attachment_url) values (v_room, a.ae_user_id, p_corps, p_piece);
exception when others then
  return;
end $function$;
revoke all on function public.terrain_poster(uuid, text, text) from public, anon, authenticated;

create or replace function public.terrain_message_fin_mission()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  m mission_menage; a auto_entrepreneur; b bien; v_room uuid; v_type text; v_corps text;
begin
  if new.statut <> 'terminee' or (tg_op = 'UPDATE' and old.statut is not distinct from 'terminee') then return new; end if;
  select * into m from mission_menage where id = new.mission_id;
  select * into a from auto_entrepreneur where id = m.ae_id;
  if a.ae_user_id is null then return new; end if;
  select * into b from bien where id = m.bien_id;
  v_room := terrain_salle_du_staff(a.id);
  if v_room is null then return new; end if;
  v_type := case new.type_terrain when 'check_in' then 'check-in' when 'recouche' then 'recouche'
              when 'demande_menage' then 'ménage de fond' when 'technique' then 'mission technique' else 'ménage' end;
  v_corps := '✅ ' || coalesce(b.code, b.hospitable_name, 'Bien') || ' ok — '
    || to_char(coalesce(new.ended_at, now()) at time zone 'Europe/Paris', 'HH24"h"MI') || ' · ' || v_type
    || case when new.video_absente_motif is not null then ' · sans vidéo (' || new.video_absente_motif || ')'
            when new.video_media_id is not null then ' · 🎥' else '' end
    || case when new.start_declare then ' · démarrage déclaré après oubli' else '' end;
  insert into chat_messages (room_id, sender_id, body) values (v_room, a.ae_user_id, v_corps);
  return new;
exception when others then
  return new;
end $function$;

-- Même correction pour la salle utilisée par 💬 Message staff / « À reprendre » / retours vidéo (_terrain_room_staff)
create or replace function public._terrain_room_staff(p_ae_id uuid)
 returns uuid language sql stable security definer set search_path to 'public' as $$
  select public.terrain_salle_du_staff(p_ae_id)
$$;
