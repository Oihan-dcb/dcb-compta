-- ═══════════════════════════════════════════════════════════════════════
-- 061_ae_linked_account.sql — Fusion d'identité dans la messagerie
-- linked_ae_user_id : compte secondaire → pointe vers le compte principal
-- Exemple : Laura-AE → Laura-staff ; Clémence-AE → Clémence-assistante
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS linked_ae_user_id uuid;
