-- 075_chat_llm_jobs.sql
-- Table de file LLM : classification des messages de chat + boîte de validation PowerHouse

CREATE TABLE IF NOT EXISTS chat_llm_jobs (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id            uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  room_id               uuid REFERENCES chat_rooms(id) ON DELETE CASCADE,
  status                text DEFAULT 'done' CHECK (status IN ('pending','processing','done','skipped')),
  llm_response          jsonb,
  proposed_action_type  text CHECK (proposed_action_type IN ('tech_issue','mission','devis_request','note','none')),
  proposed_action_data  jsonb,
  confidence            numeric(3,2),
  summary               text,
  validated_by          uuid,
  validated_at          timestamptz,
  rejected_at           timestamptz,
  rejection_reason      text,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_llm_jobs_status_idx ON chat_llm_jobs(status);
CREATE INDEX IF NOT EXISTS chat_llm_jobs_room_id_idx ON chat_llm_jobs(room_id);
CREATE INDEX IF NOT EXISTS chat_llm_jobs_created_at_idx ON chat_llm_jobs(created_at DESC);

-- RLS : lecture/écriture via service key uniquement (les APIs Vercel utilisent la service key)
ALTER TABLE chat_llm_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_llm_jobs_service_all" ON chat_llm_jobs;
CREATE POLICY "chat_llm_jobs_service_all" ON chat_llm_jobs
  FOR ALL USING (true) WITH CHECK (true);
