-- Migration 110 : Supprimer le VIR résiduel parasite "Virement propriétaire (2)" pour UIFN1P
--
-- Contexte : la logique résiduel (ventilation.js:530) calcule soldeResiduel = fin_revenue - totalLie.
-- Pour UIFN1P, le VIR principal est lié au 1er acompte (5 169,05€) uniquement.
-- soldeResiduel = 15 589,40 - 5 169,05 = 10 420,35€ → ligne VIR(2) créée à chaque recalcul.
-- Le 2ème acompte (10 270,35€) n'est pas encore raccroché → ne PAS recalculer UIFN1P
-- avant d'avoir lié ce mouvement bancaire au VIR dans le module de rapprochement.

DELETE FROM ventilation v
USING reservation r
JOIN bien b ON b.id = r.bien_id
WHERE v.reservation_id = r.id
  AND b.code = 'UIFN1P'
  AND v.code = 'VIR'
  AND v.libelle ILIKE '%(2)%';
