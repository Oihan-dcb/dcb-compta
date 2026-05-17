-- Migration 143 : Complétion schéma owner_chat
-- Colonnes et table ajoutées inline après migration 141 (non documentées)
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / IF NOT EXISTS)

-- ── owner_chat_rooms — bien_id (ajouté inline après 141) ────────────────────

ALTER TABLE owner_chat_rooms
  ADD COLUMN IF NOT EXISTS bien_id uuid REFERENCES bien(id) ON DELETE SET NULL;

-- ── owner_chat_messages — colonnes étendues ───────────────────────────────────

-- body rendu nullable (pièces jointes sans texte)
ALTER TABLE owner_chat_messages ALTER COLUMN body DROP NOT NULL;

-- Réponse citée
ALTER TABLE owner_chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_id   uuid,
  ADD COLUMN IF NOT EXISTS reply_to_body text,
  ADD COLUMN IF NOT EXISTS reply_to_name text;

-- Pièces jointes
ALTER TABLE owner_chat_messages
  ADD COLUMN IF NOT EXISTS attachment_url  text,
  ADD COLUMN IF NOT EXISTS attachment_type text CHECK (attachment_type IN ('image', 'video', 'file'));

-- Édition
ALTER TABLE owner_chat_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- ── owner_chat_message_reactions ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_chat_message_reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES owner_chat_messages(id) ON DELETE CASCADE,
  emoji       text        NOT NULL,
  sender_type text        NOT NULL CHECK (sender_type IN ('staff', 'proprio')),
  sender_id   uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, sender_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_owner_chat_reactions_message
  ON owner_chat_message_reactions(message_id);

ALTER TABLE owner_chat_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_owner_chat_reactions" ON owner_chat_message_reactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Index complémentaire ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_owner_chat_rooms_bien
  ON owner_chat_rooms(bien_id) WHERE bien_id IS NOT NULL;
