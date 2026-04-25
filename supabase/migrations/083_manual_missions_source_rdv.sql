-- 083_manual_missions_source_rdv.sql
-- Lie une mission manuelle à un staff_rdv (CI avancé validé depuis PowerHouse)
-- Permet au cron de savoir si Clémence a bien mis à jour Hospitable

ALTER TABLE manual_missions
  ADD COLUMN IF NOT EXISTS source_rdv_id uuid REFERENCES staff_rdv(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS manual_missions_source_rdv_idx ON manual_missions(source_rdv_id) WHERE source_rdv_id IS NOT NULL;
