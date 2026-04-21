-- Migration 028 : email_comptable sur agency_config
-- Pour l'envoi automatique du bilan mensuel LLD au comptable

ALTER TABLE agency_config ADD COLUMN IF NOT EXISTS email_comptable text;
