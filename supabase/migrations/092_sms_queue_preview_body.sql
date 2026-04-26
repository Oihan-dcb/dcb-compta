-- Migration 092 : colonne preview_body dans sms_queue
-- Stocke le texte SMS pré-généré pour aperçu avant envoi

ALTER TABLE sms_queue ADD COLUMN IF NOT EXISTS preview_body TEXT;
