-- 088_remove_staff_dms.sql
-- Supprime les rooms DM (type=direct) impliquant des AEs non-managers
-- (Esteban GARRIDO et Séverine POEYUSAN)
-- Les DMs sont désormais réservés aux managers uniquement.

DO $$
DECLARE
  v_esteban  uuid := '1b2ac7d5-75d2-4082-87ab-4acf134503ff';
  v_severine uuid := 'dbc0c21f-bb61-4923-891d-a34c594d4b64';
  v_room_ids uuid[];
BEGIN
  -- Trouver toutes les rooms 'direct' dont l'un des deux est membre
  SELECT ARRAY_AGG(DISTINCT crm.room_id) INTO v_room_ids
  FROM chat_room_members crm
  JOIN chat_rooms cr ON cr.id = crm.room_id
  WHERE cr.type = 'direct'
    AND crm.user_id IN (v_esteban, v_severine);

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    -- Les messages + membres sont supprimés en CASCADE
    DELETE FROM chat_rooms WHERE id = ANY(v_room_ids);
  END IF;
END;
$$;
