-- Migration 128 : ajouter agence + agence_label à sms_queue
-- Ces colonnes sont insérées par sync-reviews et lues par process-sms-queue
-- mais n'ont jamais été créées → INSERT échoue silencieusement depuis le début

ALTER TABLE sms_queue
  ADD COLUMN IF NOT EXISTS agence       text DEFAULT 'dcb',
  ADD COLUMN IF NOT EXISTS agence_label text DEFAULT 'Destination Côte Basque';

-- Backfill des lignes existantes (au cas où il y en aurait)
UPDATE sms_queue SET agence = 'dcb', agence_label = 'Destination Côte Basque'
WHERE agence IS NULL;

-- Index utile si on filtre par agence un jour
CREATE INDEX IF NOT EXISTS idx_sms_queue_agence ON sms_queue(agence);
