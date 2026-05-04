-- Migration 118 : Reset rapprochee=false pour DFJHCT (Munduz)
-- Réservation marquée rapprochée sans virement associé dans reservation_paiement.
-- Cause : validerMatchManuelResas ne renseignait pas reservation_paiement (bug corrigé dans matching.js).

UPDATE reservation
SET rapprochee = false
WHERE code = 'DFJHCT';
