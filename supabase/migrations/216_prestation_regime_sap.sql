-- Migration 216 : régime SAP sur les prestations hors forfait
--
-- Axe FACTURATION sur prestation_hors_forfait (miroir de mission_menage.regime).
-- 'sap' = prestation facturée en parallèle au crédit d'impôt (Service À la Personne)
--         → AUCUNE imputation au propriétaire (exclue de deduction_loy / debours_proprio
--         dans buildComptaMensuelle, buildRapportData, facturesEvoliz, PageFactures).
-- Appliquée en prod via MCP le 2026-06-30 ; ce fichier garde le repo/sandbox synchro.

ALTER TABLE prestation_hors_forfait
  ADD COLUMN IF NOT EXISTS regime text NOT NULL DEFAULT 'auto_dcb';

-- Backfill : une prestation hérite du régime SAP d'un ménage frère (même AE, même bien,
-- même jour) déjà classé SAP. Dérivation de la classification existante.
UPDATE prestation_hors_forfait p
SET regime = 'sap'
FROM mission_menage m
WHERE m.ae_id = p.ae_id
  AND m.bien_id = p.bien_id
  AND m.date_mission = p.date_prestation
  AND m.regime = 'sap'
  AND p.regime <> 'sap';
