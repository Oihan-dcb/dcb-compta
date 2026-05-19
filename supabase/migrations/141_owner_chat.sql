-- Migration 141 : Messagerie portail owner
-- owner_chat_rooms : rooms de chat (broadcast = Général, support = Équipe DCB par proprio)
-- owner_chat_messages : messages

CREATE TABLE IF NOT EXISTS owner_chat_rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('broadcast', 'support')),
  proprio_id uuid REFERENCES proprietaire(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  agence     text NOT NULL DEFAULT 'dcb',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1 room support maximum par proprio
CREATE UNIQUE INDEX IF NOT EXISTS uniq_proprio_support_room
  ON owner_chat_rooms(proprio_id) WHERE proprio_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS owner_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES owner_chat_rooms(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('staff', 'proprio')),
  sender_id   uuid NOT NULL,
  sender_name text NOT NULL DEFAULT '',
  body        text NOT NULL CHECK (body <> ''),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_owner_chat_messages_room
  ON owner_chat_messages(room_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE owner_chat_rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_owner_chat_rooms"    ON owner_chat_rooms;
DROP POLICY IF EXISTS "auth_all_owner_chat_messages" ON owner_chat_messages;
DROP POLICY IF EXISTS "anon_all_owner_chat_rooms"    ON owner_chat_rooms;
DROP POLICY IF EXISTS "anon_all_owner_chat_messages" ON owner_chat_messages;

CREATE POLICY "auth_all_owner_chat_rooms" ON owner_chat_rooms
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_owner_chat_rooms" ON owner_chat_rooms
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_owner_chat_messages" ON owner_chat_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_owner_chat_messages" ON owner_chat_messages
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Room broadcast globale DCB ────────────────────────────────────────────────
INSERT INTO owner_chat_rooms (type, name, agence)
VALUES ('broadcast', 'Général', 'dcb')
ON CONFLICT DO NOTHING;
