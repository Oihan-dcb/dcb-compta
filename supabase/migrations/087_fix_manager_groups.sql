-- 087_fix_manager_groups.sql
-- Les rooms Managers Bordeaux et Managers Arcachon étaient vides :
-- la migration 086 seedait depuis chat_group_slug mais Oïhan+Clémence=cote-basque
-- et Léa=arcachon (pas bordeaux).
-- Structure cible : Léa + Oïhan + Clémence dans BDX et Arcachon.

DO $$
DECLARE
  v_oihan    uuid := '62753152-5321-40ce-ac86-36a54c2de2aa';
  v_clemence uuid := 'e9b0b8f6-184b-4a43-b2e3-a90af3a5e5fa';
  v_lea      uuid := 'a55bd53b-eb9c-4927-b018-6a1569fddebe';
  v_bdx_room   uuid;
  v_arco_room  uuid;
BEGIN
  -- IDs des rooms manager_group BDX et Arcachon
  SELECT cr.id INTO v_bdx_room
  FROM chat_rooms cr
  JOIN chat_groups cg ON cg.id = cr.group_id
  WHERE cr.type = 'manager_group' AND cg.slug = 'bordeaux'
  LIMIT 1;

  SELECT cr.id INTO v_arco_room
  FROM chat_rooms cr
  JOIN chat_groups cg ON cg.id = cr.group_id
  WHERE cr.type = 'manager_group' AND cg.slug = 'arcachon'
  LIMIT 1;

  -- Managers Bordeaux : Léa + Oïhan + Clémence
  IF v_bdx_room IS NOT NULL THEN
    INSERT INTO chat_room_members (room_id, user_id)
    VALUES
      (v_bdx_room, v_lea),
      (v_bdx_room, v_oihan),
      (v_bdx_room, v_clemence)
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;

  -- Managers Arcachon : Léa + Oïhan + Clémence
  IF v_arco_room IS NOT NULL THEN
    INSERT INTO chat_room_members (room_id, user_id)
    VALUES
      (v_arco_room, v_lea),
      (v_arco_room, v_oihan),
      (v_arco_room, v_clemence)
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END IF;
END;
$$;
