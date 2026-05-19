-- Migration 154 : Table property_calendar
-- Cache des événements calendrier Hospitable par bien (réservations + bloquages).
-- Alimentée par la Edge Function sync-ical-planning (cron toutes les 5 min).
-- Utilisée par le portail owner et PowerHouse planning.
-- NOTE : planning_events existait déjà dans PowerHouse (planning staff) → nom distinct.

CREATE TABLE IF NOT EXISTS property_calendar (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bien_id       uuid NOT NULL REFERENCES bien(id) ON DELETE CASCADE,
  uid_cal       text NOT NULL,
  source        text NOT NULL DEFAULT 'direct',
  date_debut    date NOT NULL,
  date_fin      date,
  titre         text,
  statut        text NOT NULL DEFAULT 'confirmed'
    CHECK (statut IN ('confirmed', 'cancelled', 'blocked')),
  derniere_sync timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT property_calendar_bien_uid UNIQUE (bien_id, uid_cal)
);

CREATE INDEX IF NOT EXISTS idx_property_calendar_bien_dates
  ON property_calendar (bien_id, date_debut, date_fin);

CREATE INDEX IF NOT EXISTS idx_property_calendar_dates
  ON property_calendar (date_debut, date_fin);

ALTER TABLE property_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_calendar_read_authenticated"
  ON property_calendar FOR SELECT TO authenticated USING (true);

CREATE POLICY "property_calendar_write_service"
  ON property_calendar FOR ALL TO service_role USING (true);
