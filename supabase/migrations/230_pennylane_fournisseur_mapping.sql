-- Migration 230 : mapping fournisseur_recurrent → fournisseur Pennylane
--
-- Évite de recréer un fournisseur Pennylane à chaque facture importée :
-- une fois créé/résolu côté Pennylane, son id est mémorisé ici.

ALTER TABLE fournisseur_recurrent
  ADD COLUMN IF NOT EXISTS pennylane_supplier_id integer;

COMMENT ON COLUMN fournisseur_recurrent.pennylane_supplier_id IS
  'id du fournisseur côté Pennylane (agence DCB) — rempli au premier push réussi';
