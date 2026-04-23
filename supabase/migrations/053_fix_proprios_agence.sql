-- Migration 053 : Correction agence des propriétaires dont tous les biens sont Lauian
-- Passe agence='dcb' → 'lauian' pour les proprios qui ont uniquement des biens Lauian
-- et aucun bien DCB (proprios mal importés lors d'un sync Evoliz depuis DCB)

UPDATE proprietaire p
SET agence = 'lauian'
WHERE p.agence = 'dcb'
  AND EXISTS (
    SELECT 1 FROM bien b
    WHERE b.proprietaire_id = p.id
      AND b.agence = 'lauian'
  )
  AND NOT EXISTS (
    SELECT 1 FROM bien b
    WHERE b.proprietaire_id = p.id
      AND b.agence = 'dcb'
  );

-- Diagnostic : proprios DCB sans aucun bien (à vérifier manuellement)
-- SELECT id, nom, prenom, id_evoliz
-- FROM proprietaire
-- WHERE agence = 'dcb'
--   AND NOT EXISTS (SELECT 1 FROM bien WHERE proprietaire_id = proprietaire.id)
-- ORDER BY nom;
