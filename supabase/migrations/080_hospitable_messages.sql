-- 080_hospitable_messages.sql
-- Stockage des messages Hospitable (guests + host) reçus via webhook
-- Utilisé comme contexte pour le LLM dans process-chat-message.js

CREATE TABLE IF NOT EXISTS hospitable_messages (
  id                    bigint PRIMARY KEY,          -- id Hospitable (int stable)
  reservation_id        text   NOT NULL,             -- hospitable reservation UUID
  conversation_id       text,
  platform              text,
  body                  text   NOT NULL,
  sender_type           text,                        -- 'guest' | 'host'
  source                text,                        -- 'automated' | 'manual'
  created_at            timestamptz NOT NULL,
  synced_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hospitable_messages_reservation_idx
  ON hospitable_messages(reservation_id);
CREATE INDEX IF NOT EXISTS hospitable_messages_created_idx
  ON hospitable_messages(created_at DESC);

ALTER TABLE hospitable_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospitable_messages_service_all" ON hospitable_messages;
CREATE POLICY "hospitable_messages_service_all" ON hospitable_messages
  FOR ALL USING (true) WITH CHECK (true);
