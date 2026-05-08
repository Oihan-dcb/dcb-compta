-- 127_lld_fixes.sql
-- Correctifs module Locations Longues Durée

-- 1. Ajouter 'habitation' au CHECK type_bail (était 'etudiant' | 'mobilite' uniquement)
ALTER TABLE etudiant DROP CONSTRAINT IF EXISTS etudiant_type_bail_check;
ALTER TABLE etudiant ADD CONSTRAINT etudiant_type_bail_check
  CHECK (type_bail IN ('etudiant', 'mobilite', 'habitation'));

-- 2. Stocker le montant attendu dans loyer_suivi
--    Permet de détecter les écarts de paiement en DB, pas seulement côté UI
ALTER TABLE loyer_suivi ADD COLUMN IF NOT EXISTS montant_attendu integer;
