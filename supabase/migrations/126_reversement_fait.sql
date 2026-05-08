-- 126_reversement_fait.sql
-- Suivi des reversements effectués aux propriétaires (cochage manuel dans PageComptabilite)

CREATE TABLE IF NOT EXISTS reversement_fait (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bien_id   uuid        NOT NULL REFERENCES bien(id) ON DELETE CASCADE,
  mois      text        NOT NULL,   -- YYYY-MM
  agence    text        NOT NULL DEFAULT 'dcb',
  fait_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bien_id, mois, agence)
);

CREATE INDEX IF NOT EXISTS idx_reversement_fait_mois ON reversement_fait (agence, mois);

ALTER TABLE reversement_fait ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reversement_fait_open" ON reversement_fait FOR ALL USING (true) WITH CHECK (true);
