-- 330 — Message automatique dans la conversation du staff à la fin d'une mission Ma journée
-- (06/10/2026, demande Oïhan : « un message auto dans la conv du staff en mode bien X ok H »).
-- Déclenché quand mission_terrain passe à 'terminee' (vidéo envoyée, « je ne peux pas filmer »,
-- régularisation…). Conversation = staff_room du staff (celle à son nom, créée par ensure_ae_chat_rooms).
-- Expéditeur = le staff lui-même. Pas de push (in-app uniquement, pour ne pas spammer les managers).
create or replace function public.terrain_message_fin_mission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m mission_menage; a auto_entrepreneur; b bien; v_room uuid; v_type text; v_corps text;
begin
  if new.statut <> 'terminee' or (tg_op = 'UPDATE' and old.statut is not distinct from 'terminee') then return new; end if;
  select * into m from mission_menage where id = new.mission_id;
  select * into a from auto_entrepreneur where id = m.ae_id;
  if a.ae_user_id is null then return new; end if;
  select * into b from bien where id = m.bien_id;
  select r.id into v_room
    from chat_rooms r join chat_room_members cm on cm.room_id = r.id and cm.user_id = a.ae_user_id
   where r.type = 'staff_room'
   order by (r.name ilike coalesce(nullif(a.prenom, ''), '§') || '%') desc, r.created_at
   limit 1;
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
  return new; -- jamais bloquer la fin de mission pour un message
end $$;

drop trigger if exists trg_terrain_message_fin_mission on public.mission_terrain;
create trigger trg_terrain_message_fin_mission
  after insert or update of statut on public.mission_terrain
  for each row execute function public.terrain_message_fin_mission();
