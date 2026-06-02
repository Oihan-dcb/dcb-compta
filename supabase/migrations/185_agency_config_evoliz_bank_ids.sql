-- Migration 185 : ajout des IDs de comptes bancaires Evoliz dans agency_config
-- Permet de lire dynamiquement bankAccountId dans evoliz.js au lieu de hardcoder

ALTER TABLE agency_config
  ADD COLUMN IF NOT EXISTS evoliz_bank_id_agence  integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS evoliz_bank_id_seq_lc  integer DEFAULT NULL;

COMMENT ON COLUMN agency_config.evoliz_bank_id_agence IS
  'ID Evoliz du compte courant agence (bankaccountid). Visible dans Evoliz > Paramètres > Banques. Utilisé sur les factures honoraires pour la conformité facturation électronique (août 2026).';

COMMENT ON COLUMN agency_config.evoliz_bank_id_seq_lc IS
  'ID Evoliz du compte séquestre LC (bankaccountid). DCB = 133140. Utilisé sur les factures débours.';
