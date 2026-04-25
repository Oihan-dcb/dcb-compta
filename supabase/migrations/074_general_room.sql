-- 074_general_room.sql
-- Salon Général : canal d'annonces, managers only post, AEs read-only, read receipts

-- 1. Étendre la contrainte room_role pour accepter 'general'
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_room_role_check;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_room_role_check
  CHECK (room_role IN ('planning','terrain','general'));

-- Ajouter is_announcement sur chat_rooms
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS is_announcement boolean DEFAULT false;

-- 2. Table de confirmations de lecture
CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  read_at    timestamptz DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE chat_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reads select all" ON chat_message_reads;
CREATE POLICY "reads select all" ON chat_message_reads
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "reads insert own" ON chat_message_reads;
CREATE POLICY "reads insert own" ON chat_message_reads
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 3. Créer le salon Général (idempotent)
DO $$
DECLARE
  v_room_id uuid;
BEGIN
  -- Créer seulement s'il n'existe pas encore
  INSERT INTO chat_rooms (type, name, room_role, is_announcement)
  SELECT 'open', 'Général', 'general', true
  WHERE NOT EXISTS (SELECT 1 FROM chat_rooms WHERE room_role = 'general')
  RETURNING id INTO v_room_id;

  -- Si déjà existant, récupérer l'id
  IF v_room_id IS NULL THEN
    SELECT id INTO v_room_id FROM chat_rooms WHERE room_role = 'general' LIMIT 1;
    -- S'assurer que le flag est bien positionné
    UPDATE chat_rooms SET is_announcement = true WHERE id = v_room_id;
  END IF;

  -- Ajouter tous les AEs actifs comme membres
  INSERT INTO chat_room_members (room_id, user_id, involvement)
  SELECT v_room_id, ae_user_id, 'mentions'
  FROM auto_entrepreneur
  WHERE actif = true AND ae_user_id IS NOT NULL
  ON CONFLICT (room_id, user_id) DO NOTHING;
END;
$$;
