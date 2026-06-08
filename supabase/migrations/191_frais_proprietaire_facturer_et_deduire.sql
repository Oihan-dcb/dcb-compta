-- Migration 191 : ajouter mode_traitement 'facturer_et_deduire'
-- Pour les biens LAUIAN : DCB facture une prestation au proprio via Evoliz
-- ET la déduit du reversement mensuel dans le rapport.
-- Comportement = facturer_direct (crée facture Evoliz) + deduire_loyer (réduit le reversement).

ALTER TABLE frais_proprietaire
  DROP CONSTRAINT IF EXISTS frais_proprietaire_mode_traitement_check;

ALTER TABLE frais_proprietaire
  ADD CONSTRAINT frais_proprietaire_mode_traitement_check
  CHECK (mode_traitement = ANY (ARRAY[
    'deduire_loyer'::text,
    'facturer_direct'::text,
    'remboursement'::text,
    'facturer_et_deduire'::text
  ]));
