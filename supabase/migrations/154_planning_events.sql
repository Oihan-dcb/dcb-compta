-- Migration 154 : Table planning_events
--
-- Source unique de vérité pour les disponibilités des biens,
-- alimentée par le cron sync-ical-planning (toutes les 5 min).
-- Permet à PowerHouse et au portail owner de lire les resas
-- AVANT la ventilation mensuelle.

CREATE TABLE IF NOT EXISTS planning_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bien_id       uuid NOT NULL REFERENCES bien(id) ON DELETE CASCADE,
  uid_ical      text NOT NULL,
  source        text NOT NULL DEFAULT 'direct',  -- 'airbnb','booking','abritel','direct','blocked'
  date_debut    date NOT NULL,
  date_fin      date,
  titre         text,
  statut        text NOT NULL DEFAULT 'confirmed'
    CHECK (statut IN ('confirmed', 'cancelled', 'blocked')),
  derniere_sync timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT planning_events_bien_uid UNIQUE (bien_id, uid_ical)
);

-- Index pour les requêtes fréquentes (planning par bien + période)
CREATE INDEX IF NOT EXISTS idx_planning_events_bien_dates
  ON planning_events (bien_id, date_debut, date_fin);

CREATE INDEX IF NOT EXISTS idx_planning_events_dates
  ON planning_events (date_debut, date_fin);

-- RLS : lecture pour authenticated (PowerHouse + portail owner)
ALTER TABLE planning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planning_events_read_authenticated"
  ON planning_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "planning_events_write_service"
  ON planning_events FOR ALL
  TO service_role
  USING (true);

COMMENT ON TABLE planning_events IS
  'Disponibilités des biens alimentées par cron iCal (sync-ical-planning, toutes les 5 min). Lecture-only pour PowerHouse et portail owner.';
