-- Migration 010 : Ajouter 'ventilation' comme source_type valide
-- La refonte de allocate-encaissements utilise ventilation.mouvement_id
-- comme chemin de preuve bancaire — il faut l'autoriser dans la contrainte.

ALTER TABLE encaissement_allocation
  DROP CONSTRAINT IF EXISTS encaissement_allocation_source_type_check;

ALTER TABLE encaissement_allocation
  ADD CONSTRAINT encaissement_allocation_source_type_check
    CHECK (source_type IN ('payout_hospitable', 'reservation_paiement', 'ventilation', 'manual'));
