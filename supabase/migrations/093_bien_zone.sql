-- Migration 093 : colonne zone sur bien
-- Zone géographique pour personnaliser les SMS (ex: "Côte Basque", "Bordeaux", "Arcachon")

ALTER TABLE bien ADD COLUMN IF NOT EXISTS zone TEXT DEFAULT NULL;

-- Mettre à jour la colonne zone dans sms_queue pour stocker la zone au moment de l'envoi
ALTER TABLE sms_queue ADD COLUMN IF NOT EXISTS property_zone TEXT DEFAULT NULL;
