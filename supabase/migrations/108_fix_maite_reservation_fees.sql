-- Migration 108 : Fix données reservation_fee Maison Maïté
-- Bug A : supprimer les lignes en double pour les 2 réservations Booking
-- Bug D : corriger fee_type='host_fee' → 'guest_fee' pour les Resort fees manuelles

-- ── Bug A : doublons Booking ──────────────────────────────────────────────────
-- Les réservations 6872563285 (Gaxuxa Laurence) et 6872572378 (Ibañeta Laurence)
-- ont chaque ligne de reservation_fee en double (import Booking défectueux).
-- On garde la ligne avec le plus petit id (la première insérée) et supprime les doublons.

WITH ranked AS (
  SELECT
    rf.id,
    ROW_NUMBER() OVER (
      PARTITION BY rf.reservation_id, rf.label, rf.amount, rf.fee_type
      ORDER BY rf.id
    ) AS rn
  FROM reservation_fee rf
  JOIN reservation r ON r.id = rf.reservation_id
  WHERE r.code IN ('6872563285', '6872572378')
)
DELETE FROM reservation_fee
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Bug D : Resort fee mal classée en host_fee ────────────────────────────────
-- Pour les réservations manuelles PMCVUN (Bixintxo) et PDLQRG (Txomin),
-- la "Resort fee" est stockée avec fee_type='host_fee' (positif) au lieu de 'guest_fee'.
-- Cela gonfle hostServiceFee → commissionableBase → HON légèrement sur-facturé.

UPDATE reservation_fee rf
SET fee_type = 'guest_fee'
FROM reservation r
WHERE r.id = rf.reservation_id
  AND r.code IN ('PMCVUN', 'PDLQRG')
  AND rf.label ILIKE '%resort%'
  AND rf.amount > 0
  AND rf.fee_type = 'host_fee';
