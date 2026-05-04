-- Migration 109 : Supprimer les lignes VIR résiduelles parasites pour bien UIFN1P
-- Bug C : lors du recalcul d'Avril 2026, la logique "résiduel VIR" (ventilation.js:530)
-- a inséré une 2ème ligne VIR (sans mouvement_id) pour les réservations de Maïté entière
-- qui avaient déjà un mouvement bancaire lié. Cette ligne gonfle VIR et fausse la taxe séjour.
--
-- Critère de suppression : ligne VIR avec mouvement_id IS NULL alors qu'une autre ligne VIR
-- pour la MÊME réservation possède un mouvement_id (= c'est le résiduel auto-inséré).

DELETE FROM ventilation v
WHERE v.code = 'VIR'
  AND v.mouvement_id IS NULL
  AND v.calcul_source = 'auto'
  AND EXISTS (
    SELECT 1
    FROM ventilation v2
    JOIN reservation r ON r.id = v2.reservation_id
    JOIN bien b ON b.id = r.bien_id
    WHERE v2.reservation_id = v.reservation_id
      AND v2.code = 'VIR'
      AND v2.mouvement_id IS NOT NULL
      AND b.code = 'UIFN1P'
  );
