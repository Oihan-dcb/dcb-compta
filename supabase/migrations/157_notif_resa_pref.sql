-- Migration 157 : Préférence notification nouvelle réservation
-- Colonne notif_resa dans owner_visibility_config (true par défaut)

ALTER TABLE owner_visibility_config
  ADD COLUMN IF NOT EXISTS notif_resa boolean NOT NULL DEFAULT true;
