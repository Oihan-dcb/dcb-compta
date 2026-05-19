-- Tracking de l'ID de message Hospitable dans sms_logs
-- Permet de retrouver le message envoyé côté Hospitable

ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS hospitable_message_id text;

-- Élargir le status check pour inclure 'preview' (test mode)
ALTER TABLE sms_logs DROP CONSTRAINT IF EXISTS sms_logs_status_check;
ALTER TABLE sms_logs ADD CONSTRAINT sms_logs_status_check
  CHECK (status IN ('sent', 'error', 'no_phone', 'skipped', 'preview'));
