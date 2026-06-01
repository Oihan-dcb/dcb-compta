-- Migration 180 : liaison paiement_contrat ↔ mouvement_bancaire
-- Permet le rapprochement des PAYIN Stripe contrats avec les mouvements bancaires

ALTER TABLE paiement_contrat
  ADD COLUMN IF NOT EXISTS mouvement_bancaire_id UUID REFERENCES mouvement_bancaire(id),
  ADD COLUMN IF NOT EXISTS rapproche_banque_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS paiement_contrat_mouvement_idx
  ON paiement_contrat(mouvement_bancaire_id);

-- RLS : anon peut lire les nouveaux champs (policy existante couvre SELECT *)
