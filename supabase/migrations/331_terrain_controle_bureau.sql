-- 331 — Contrôle bureau d'une mission Ma journée depuis PowerHouse 📍 Terrain (06/10/2026, Oïhan :
-- « quand je vérifie un ménage j'aimerais avoir la main sur les signalements etc. »).
--   • controle_statut 'ok' | 'a_reprendre' + note, par / le : vérification de la vidéo par le bureau ;
--   • terrain_message_staff : remarque envoyée dans la conversation du staff, préfixée du bien et du jour.
-- Les signalements / technique / sac sont créés directement par PowerHouse (RLS staff existante).
alter table public.mission_terrain add column if not exists controle_statut text check (controle_statut in ('ok', 'a_reprendre'));
alter table public.mission_terrain add column if not exists controle_note text;
alter table public.mission_terrain add column if not exists controle_par uuid;
alter table public.mission_terrain add column if not exists controle_at timestamptz;

create or replace function public._terrain_room_staff(p_ae_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select r.id from auto_entrepreneur a
    join chat_room_members cm on cm.user_id = a.ae_user_id
    join chat_rooms r on r.id = cm.room_id and r.type = 'staff_room'
   where a.id = p_ae_id
   order by (r.name ilike coalesce(nullif(a.prenom, ''), '§') || '%') desc, r.created_at
   limit 1;
$$;
revoke all on function public._terrain_room_staff(uuid) from public, anon, authenticated;

create or replace function public._terrain_check_bureau(p_mission_id uuid)
returns mission_menage language plpgsql stable security definer set search_path = public as $$
declare m mission_menage;
begin
  select * into m from mission_menage where id = p_mission_id;
  if not found then raise exception 'mission_introuvable'; end if;
  if not (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))))
  then raise exception 'acces_refuse'; end if;
  return m;
end $$;
revoke all on function public._terrain_check_bureau(uuid) from public, anon, authenticated;

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
  values (v_room, auth.uid(), '📍 ' || coalesce(v_bien, 'Mission') || ' (' || to_char(m.date_mission, 'DD/MM') || ') — ' || trim(p_texte))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.terrain_message_staff(uuid, text) from public, anon;
grant execute on function public.terrain_message_staff(uuid, text) to authenticated;

create or replace function public.terrain_controle_bureau(p_mission_id uuid, p_statut text, p_note text default null)
returns public.mission_terrain language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain;
begin
  m := _terrain_check_bureau(p_mission_id);
  if p_statut is not null and p_statut not in ('ok', 'a_reprendre') then raise exception 'statut_invalide'; end if;
  if p_statut = 'a_reprendre' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'note_obligatoire'; end if;
  update mission_terrain set controle_statut = p_statut, controle_note = nullif(trim(coalesce(p_note, '')), ''),
         controle_par = case when p_statut is null then null else auth.uid() end,
         controle_at = case when p_statut is null then null else now() end, updated_at = now()
   where mission_id = p_mission_id returning * into t;
  if not found then raise exception 'mission_non_demarree'; end if;
  if p_statut = 'a_reprendre' then
    perform terrain_message_staff(p_mission_id, '⚠️ À reprendre : ' || trim(p_note));
  end if;
  return t;
end $$;
revoke all on function public.terrain_controle_bureau(uuid, text, text) from public, anon;
grant execute on function public.terrain_controle_bureau(uuid, text, text) to authenticated;
