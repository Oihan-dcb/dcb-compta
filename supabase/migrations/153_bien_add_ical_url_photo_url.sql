-- Migration 153 : Ajouter ical_url et photo_url sur la table bien
-- ical_url   : URL complète du feed iCal (ex: https://www.airbnb.com/calendar/ical/...)
--              Utilisé pour le cron de sync planning_events
-- photo_url  : URL publique de la photo principale du bien (pour portail owner et planning)

ALTER TABLE bien
  ADD COLUMN IF NOT EXISTS ical_url  text,
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN bien.ical_url  IS 'URL iCal complète pour sync cron → planning_events';
COMMENT ON COLUMN bien.photo_url IS 'URL publique de la photo principale du bien';
