-- Migration 121 : Marquer HOST-FJ3DGE (Otsoa Dubief) comme rapprochée
-- syncStripe avait matché le mouvement bancaire mais n'insérait pas reservation_paiement
-- ni ne mettait rapprochee=true. Bug corrigé dans syncStripe.js.
-- On corrige l'état existant manuellement.

UPDATE reservation
SET rapprochee = true
WHERE code = 'HOST-FJ3DGE';

-- Insérer reservation_paiement si le mouvement Stripe existe déjà rapproché
INSERT INTO reservation_paiement (reservation_id, mouvement_id, montant, date_paiement, type_paiement)
SELECT
  r.id,
  m.id,
  m.credit,
  m.date_operation,
  'total'
FROM reservation r
JOIN mouvement_bancaire m ON m.statut_matching = 'rapproche' AND m.canal = 'stripe'
  AND m.agence = 'lauian'
  AND ABS(m.credit - 38995) <= 2  -- 389,95 € en centimes
WHERE r.code = 'HOST-FJ3DGE'
  AND NOT EXISTS (
    SELECT 1 FROM reservation_paiement rp
    WHERE rp.reservation_id = r.id AND rp.mouvement_id = m.id
  )
LIMIT 1;
