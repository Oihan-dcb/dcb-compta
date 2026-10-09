-- 377 — terrain_poster : ne plus poster dans la salle d'un AUTRE AE (09/10/2026).
-- Bug : la confirmation « ✅ BGH ok — check-in » de Léa (manager Bordeaux, sans salle staff à son
-- nom) est partie dans la salle « Kathy Lerot » : la fonction prenait n'importe quelle staff_room dont
-- l'AE était MEMBRE (les managers sont membres des salles de leurs AE), triée par nom puis date.
-- Même défaut pour Clémence, Laura et Oïhan (managers) : leurs confirmations partaient chez Kathy.
-- Désormais :
--   1. la staff_room À SON NOM (prénom + nom, puis prénom seul) ;
--   2. sinon (manager qui fait une mission) : son groupe « Managers … » (manager_group) ;
--   3. sinon rien (pas de mauvaise salle).
create or replace function public.terrain_poster(p_mission_id uuid, p_corps text, p_piece text default null)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare m mission_menage; a auto_entrepreneur; v_room uuid; v_nom text; v_prenom text;
begin
  select * into m from mission_menage where id = p_mission_id;
  if m.id is null then return; end if;
  select * into a from auto_entrepreneur where id = m.ae_id;
  if a.ae_user_id is null then return; end if;
  -- Compte sans prénom (ex. « Conciergerie ») : le nom sert de prénom.
  v_prenom := coalesce(nullif(trim(coalesce(a.prenom, '')), ''), nullif(trim(coalesce(a.nom, '')), ''));
  v_nom := nullif(trim(trim(coalesce(a.prenom, '')) || ' ' || trim(coalesce(a.nom, ''))), '');

  select r.id into v_room
    from chat_rooms r join chat_room_members cm on cm.room_id = r.id and cm.user_id = a.ae_user_id
   where r.type = 'staff_room'
     and v_prenom is not null
     and (lower(r.name) = lower(v_nom) or lower(r.name) like lower(v_prenom) || ' %' or lower(r.name) = lower(v_prenom))
   order by (lower(r.name) = lower(v_nom)) desc, r.created_at
   limit 1;

  if v_room is null then
    select r.id into v_room
      from chat_rooms r join chat_room_members cm on cm.room_id = r.id and cm.user_id = a.ae_user_id
     where r.type = 'manager_group'
     order by r.created_at
     limit 1;
  end if;

  if v_room is null then return; end if;
  insert into chat_messages (room_id, sender_id, body, attachment_url) values (v_room, a.ae_user_id, p_corps, p_piece);
exception when others then
  return;
end $function$;
revoke all on function public.terrain_poster(uuid, text, text) from public, anon, authenticated;
