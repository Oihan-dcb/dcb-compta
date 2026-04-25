-- 076_staff_rdv.sql
-- Table des rendez-vous staff créés via validation LLM (feed iCal dynamique)

CREATE TABLE IF NOT EXISTS staff_rdv (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id        text NOT NULL,           -- prenom normalisé (ex: "oihan")
  title           text NOT NULL,
  date_start      timestamptz NOT NULL,
  date_end        timestamptz,             -- null = date_start + 1h
  description     text,
  bien_code       text,
  location        text,
  source          text DEFAULT 'llm' CHECK (source IN ('llm','manual')),
  source_job_id   uuid REFERENCES chat_llm_jobs(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_rdv_staff_id_idx ON staff_rdv(staff_id);
CREATE INDEX IF NOT EXISTS staff_rdv_date_start_idx ON staff_rdv(date_start);

ALTER TABLE staff_rdv ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_rdv_service_all" ON staff_rdv;
CREATE POLICY "staff_rdv_service_all" ON staff_rdv
  FOR ALL USING (true) WITH CHECK (true);

-- Étendre le CHECK de chat_llm_jobs pour accepter 'rdv'
ALTER TABLE chat_llm_jobs DROP CONSTRAINT IF EXISTS chat_llm_jobs_proposed_action_type_check;
ALTER TABLE chat_llm_jobs ADD CONSTRAINT chat_llm_jobs_proposed_action_type_check
  CHECK (proposed_action_type IN ('tech_issue','mission','devis_request','note','none','rdv'));
