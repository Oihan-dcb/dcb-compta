-- Migration 186 : Corriger rapprochee=false pour les réservations liées via payout_hospitable
--
-- Root cause : la contrainte UNIQUE sur reservation_paiement(reservation_id, mouvement_id)
-- était absente. L'upsert de _lierViaPayout avec onConflict renvoyait l'erreur PostgreSQL 42P10
-- ("there is no unique or exclusion constraint matching the ON CONFLICT specification").
-- Le code ne vérifiait pas l'erreur → aucune ligne insérée → totalRecu=0 → estComplet=false
-- → rapprochee=false, alors que mouvement_bancaire.statut_matching='rapproche' était bien posé.
-- Même bug que mig 118 (manuel) et 121 (Stripe), ici pour Airbnb/Booking via _lierViaPayout.

-- 1. Supprimer les doublons (garder la ligne avec le montant le plus élevé, puis la plus ancienne)
DELETE FROM reservation_paiement
WHERE id NOT IN (
  SELECT DISTINCT ON (reservation_id, mouvement_id) id
  FROM reservation_paiement
  ORDER BY reservation_id, mouvement_id, COALESCE(montant, 0) DESC, created_at ASC
);

-- 2. Ajouter la contrainte UNIQUE si elle n'existe pas déjà
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservation_paiement_resa_mouv_unique'
    AND conrelid = 'reservation_paiement'::regclass
  ) THEN
    ALTER TABLE reservation_paiement
    ADD CONSTRAINT reservation_paiement_resa_mouv_unique
    UNIQUE (reservation_id, mouvement_id);
  END IF;
END $$;

-- 3. Créer les reservation_paiement manquants pour les resas rapprochées via payout_hospitable
--    (statut_matching='rapproche' côté mouvement, mais pas de ligne reservation_paiement)
INSERT INTO reservation_paiement (reservation_id, mouvement_id, montant, date_paiement, type_paiement)
SELECT DISTINCT ON (r.id, ph.mouvement_id)
  r.id                                                         AS reservation_id,
  ph.mouvement_id,
  LEAST(COALESCE(r.fin_revenue, 0), mb.credit)                AS montant,
  mb.date_operation                                            AS date_paiement,
  'total'                                                      AS type_paiement
FROM reservation r
JOIN payout_reservation pr  ON pr.reservation_id = r.id
JOIN payout_hospitable  ph  ON ph.id = pr.payout_id
JOIN mouvement_bancaire mb  ON mb.id = ph.mouvement_id
WHERE ph.mouvement_id IS NOT NULL
  AND mb.statut_matching = 'rapproche'
  AND r.rapprochee = false
  AND r.fin_revenue > 0
  AND NOT EXISTS (
    SELECT 1 FROM reservation_paiement rp
    WHERE rp.reservation_id = r.id
      AND rp.mouvement_id   = ph.mouvement_id
  )
ON CONFLICT (reservation_id, mouvement_id) DO NOTHING;

-- 4. Marquer rapprochee=true pour toutes les resas dont les paiements couvrent >= 99% du fin_revenue
UPDATE reservation r
SET rapprochee = true
WHERE r.rapprochee = false
  AND r.fin_revenue > 0
  AND EXISTS (
    SELECT 1
    FROM reservation_paiement rp
    WHERE rp.reservation_id = r.id
    GROUP BY rp.reservation_id
    HAVING SUM(COALESCE(rp.montant, 0)) >= r.fin_revenue * 0.99
  );
