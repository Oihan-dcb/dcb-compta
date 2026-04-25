-- 079_chat_llm_jobs_hospitable.sql
-- Étend chat_llm_jobs pour accueillir les messages guests Hospitable
-- (message_id et room_id restent null pour source='hospitable')

ALTER TABLE chat_llm_jobs
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'internal'
    CHECK (source IN ('internal','hospitable')),
  ADD COLUMN IF NOT EXISTS hospitable_reservation_id text,
  ADD COLUMN IF NOT EXISTS hospitable_property_id   text,
  ADD COLUMN IF NOT EXISTS hospitable_guest_name    text,
  ADD COLUMN IF NOT EXISTS hospitable_message_body  text;

CREATE INDEX IF NOT EXISTS chat_llm_jobs_source_idx
  ON chat_llm_jobs(source);
CREATE INDEX IF NOT EXISTS chat_llm_jobs_hosp_resa_idx
  ON chat_llm_jobs(hospitable_reservation_id);
