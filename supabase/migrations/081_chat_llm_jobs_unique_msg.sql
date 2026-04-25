-- 081_chat_llm_jobs_unique_msg.sql
-- Contrainte d'unicité sur message_id pour éviter les doublons
-- quand plusieurs clients PowerHouse sont ouverts simultanément

CREATE UNIQUE INDEX IF NOT EXISTS chat_llm_jobs_message_id_unique
  ON chat_llm_jobs(message_id)
  WHERE message_id IS NOT NULL;
