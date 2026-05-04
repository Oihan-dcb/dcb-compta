-- Migration 114 : Mettre à jour les libellés RGLM existants avec numérotation
-- "Solde bancaire à rapprocher" → "Règlement N" (N = nb paiements reçus + 1)

UPDATE ventilation v
SET libelle = 'Règlement ' || (
  SELECT COUNT(*) + 1
  FROM reservation_paiement rp
  WHERE rp.reservation_id = v.reservation_id
)
WHERE v.code = 'RGLM'
  AND v.calcul_source = 'residuel';
