-- ═══════════════════════════════════════════════════════════════════════
-- 060_ae_chat_hidden.sql — Comptes secondaires masqués dans la messagerie
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS is_chat_hidden boolean NOT NULL DEFAULT false;
