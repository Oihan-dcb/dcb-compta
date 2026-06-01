-- Migration 178 : étend les valeurs autorisées du statut owner_requests
-- Ajoute : pending_dcb (blocage Hospitable en attente confirmation DCB)
--          expire     (blocage temporaire 72h expiré automatiquement)
--          annule_proprio (proprio a annulé sa demande de blocage)

ALTER TABLE owner_requests
  DROP CONSTRAINT IF EXISTS owner_requests_statut_check;

ALTER TABLE owner_requests
  ADD CONSTRAINT owner_requests_statut_check
  CHECK (statut IN (
    'recu',
    'pending_dcb',
    'en_cours',
    'traite',
    'ferme',
    'expire',
    'annule_proprio'
  ));
