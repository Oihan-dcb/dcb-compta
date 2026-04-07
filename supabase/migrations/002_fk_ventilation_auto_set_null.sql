-- Migration 002 : FK mission_menage.ventilation_auto_id → ON DELETE SET NULL
-- Objectif : Postgres gère automatiquement le déliage quand une ligne ventilation est supprimée,
-- ce qui permet de supprimer la logique manuelle NULL/re-lien dans ventilation.js et global-sync.

ALTER TABLE mission_menage
  DROP CONSTRAINT IF EXISTS mission_menage_ventilation_auto_id_fkey,
  ADD CONSTRAINT mission_menage_ventilation_auto_id_fkey
    FOREIGN KEY (ventilation_auto_id)
    REFERENCES ventilation(id)
    ON DELETE SET NULL;
