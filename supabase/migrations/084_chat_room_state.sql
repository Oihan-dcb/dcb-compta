-- 084_chat_room_state.sql
-- Contexte actif par room : évite les doublons LLM et enrichit le prompt avec le sujet en cours

CREATE TABLE IF NOT EXISTS chat_room_state (
  room_id          text PRIMARY KEY,
  bien_code        text,
  action_in_progress text CHECK (action_in_progress IN ('tech_issue','mission','devis_request','rdv','note')),
  pending_job_id   uuid REFERENCES chat_llm_jobs(id) ON DELETE SET NULL,
  action_date      text,        -- YYYY-MM-DD (pour rdv/mission)
  context_summary  text,        -- résumé court du sujet actif
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE chat_room_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_room_state_all" ON chat_room_state;
CREATE POLICY "chat_room_state_all" ON chat_room_state FOR ALL USING (true) WITH CHECK (true);
