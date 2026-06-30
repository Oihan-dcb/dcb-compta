-- Migration 217 : heures contrat hebdo par salarié (fiche navette)
--
-- Remplace le « 35 » codé en dur dans auto-navette-mensuelle par une valeur par salarié.
-- Défaut 35 = ancien comportement (temps plein). Manon = CDI 15h/semaine.
-- Appliquée en prod via MCP le 2026-06-30 ; ce fichier garde le repo/sandbox synchro.

ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS heures_contrat numeric NOT NULL DEFAULT 35;

UPDATE auto_entrepreneur SET heures_contrat = 15
WHERE id = 'a1b27db0-cd6b-48ed-b9a3-d4dab3c83b8a';  -- Manon Castet (compte staff)
