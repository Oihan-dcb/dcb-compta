-- 082_chat_llm_jobs_fix_columns.sql
-- La table chat_llm_jobs vient de migration 058 et manque de colonnes
-- ajoutées dans 075 (CREATE TABLE IF NOT EXISTS a skipé la recréation)

-- Colonnes manquantes de la version 075
ALTER TABLE chat_llm_jobs
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS summary    text;

-- Rendre message_id nullable pour les jobs Hospitable (source='hospitable')
ALTER TABLE chat_llm_jobs
  ALTER COLUMN message_id DROP NOT NULL;

-- S'assurer que la contrainte action_type inclut 'rdv'
ALTER TABLE chat_llm_jobs
  DROP CONSTRAINT IF EXISTS chat_llm_jobs_proposed_action_type_check;
ALTER TABLE chat_llm_jobs
  ADD CONSTRAINT chat_llm_jobs_proposed_action_type_check
  CHECK (proposed_action_type IN ('tech_issue','mission','devis_request','note','none','rdv'));

-- S'assurer que la politique "service_all" existe
DROP POLICY IF EXISTS "chat_llm_jobs_service_all" ON chat_llm_jobs;
CREATE POLICY "chat_llm_jobs_service_all" ON chat_llm_jobs
  FOR ALL USING (true) WITH CHECK (true);
