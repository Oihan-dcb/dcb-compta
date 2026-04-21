-- Migration 033 : saisie des heures journalières du staff salarié (Clémence + saisonniers)
-- Remplace la saisie manuelle Laura → navette email auto vers cabinet Compact

CREATE TABLE IF NOT EXISTS staff_heures_jour (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  agence       text    NOT NULL DEFAULT 'dcb',
  ae_id        uuid    NOT NULL REFERENCES auto_entrepreneur(id) ON DELETE CASCADE,
  mois         text    NOT NULL,  -- YYYY-MM (dénormalisé pour perf)
  date         date    NOT NULL,
  heure_debut  time,              -- null = absence journée entière
  heure_fin    time,
  pause_min    integer NOT NULL DEFAULT 0,
  type_absence text,              -- null | conge_paye | maladie | rtt | ferie | repos
  notes        text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (ae_id, date)
);

ALTER TABLE staff_heures_jour ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all_staff_heures" ON staff_heures_jour FOR ALL TO public USING (true) WITH CHECK (true);
