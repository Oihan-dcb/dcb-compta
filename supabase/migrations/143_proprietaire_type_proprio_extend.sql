-- Migration 143 : Étendre la contrainte type_proprio
-- Ajoute client, etudiant, fournisseur, autre (déjà dans TYPE_LABELS frontend)

ALTER TABLE proprietaire
  DROP CONSTRAINT IF EXISTS proprietaire_type_proprio_check;

ALTER TABLE proprietaire
  ADD CONSTRAINT proprietaire_type_proprio_check
  CHECK (type_proprio IN ('particulier', 'sci', 'societe', 'indivision', 'client', 'etudiant', 'fournisseur', 'autre'));
