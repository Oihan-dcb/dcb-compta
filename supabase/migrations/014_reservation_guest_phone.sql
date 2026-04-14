-- Ajout du numéro de téléphone guest sur la réservation
-- Capturé lors du webhook de réservation Hospitable
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS guest_phone text;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS guest_country text;
