-- 086_messagerie_restructure.sql
-- Nouveaux types : manager_group (managers entre eux) + staff_room (managers + 1 AE)
-- Remplace le modèle Planning/Terrain par des rooms contextuelles par personne

-- 1. Étendre la contrainte type
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_type_check;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_type_check
  CHECK (type IN ('open','inbox','direct','manager_group','staff_room'));

-- 2. Créer la room manager_group pour chaque groupe existant
DO $$
DECLARE
  v_group RECORD;
  v_room_id uuid;
BEGIN
  FOR v_group IN SELECT id, name, slug FROM chat_groups LOOP
    SELECT id INTO v_room_id
    FROM chat_rooms
    WHERE type = 'manager_group' AND group_id = v_group.id
    LIMIT 1;

    IF v_room_id IS NULL THEN
      INSERT INTO chat_rooms (type, name, group_id)
      VALUES ('manager_group', 'Managers ' || v_group.name, v_group.id)
      RETURNING id INTO v_room_id;
    END IF;

    -- Ajouter tous les managers du groupe
    INSERT INTO chat_room_members (room_id, user_id)
    SELECT v_room_id, ae.ae_user_id
    FROM auto_entrepreneur ae
    WHERE ae.is_chat_manager = true
      AND ae.actif = true
      AND ae.ae_user_id IS NOT NULL
      AND ae.chat_group_slug = v_group.slug
    ON CONFLICT (room_id, user_id) DO NOTHING;
  END LOOP;
END;
$$;

-- 3. Créer une staff_room pour chaque AE non-manager actif
DO $$
DECLARE
  v_ae RECORD;
  v_group_id uuid;
  v_room_id uuid;
BEGIN
  FOR v_ae IN
    SELECT ae.ae_user_id,
           ae.prenom,
           ae.nom,
           ae.chat_group_slug
    FROM auto_entrepreneur ae
    WHERE ae.is_chat_manager = false
      AND ae.actif = true
      AND ae.ae_user_id IS NOT NULL
      AND ae.is_chat_hidden IS NOT TRUE
      AND ae.chat_group_slug IS NOT NULL
  LOOP
    SELECT id INTO v_group_id FROM chat_groups WHERE slug = v_ae.chat_group_slug;
    IF v_group_id IS NULL THEN CONTINUE; END IF;

    -- Vérifier si une staff_room existe déjà pour cet AE dans ce groupe
    SELECT cr.id INTO v_room_id
    FROM chat_rooms cr
    JOIN chat_room_members crm ON crm.room_id = cr.id
    WHERE cr.type = 'staff_room'
      AND cr.group_id = v_group_id
      AND crm.user_id = v_ae.ae_user_id
    LIMIT 1;

    IF v_room_id IS NULL THEN
      INSERT INTO chat_rooms (type, name, group_id)
      VALUES ('staff_room', v_ae.prenom || COALESCE(' ' || v_ae.nom, ''), v_group_id)
      RETURNING id INTO v_room_id;

      -- Ajouter l'AE
      INSERT INTO chat_room_members (room_id, user_id)
      VALUES (v_room_id, v_ae.ae_user_id)
      ON CONFLICT DO NOTHING;

      -- Ajouter tous les managers du groupe
      INSERT INTO chat_room_members (room_id, user_id)
      SELECT v_room_id, ae.ae_user_id
      FROM auto_entrepreneur ae
      WHERE ae.is_chat_manager = true
        AND ae.actif = true
        AND ae.ae_user_id IS NOT NULL
        AND ae.chat_group_slug = v_ae.chat_group_slug
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
