-- Migration 043 : corriger le bien d'Adrien Thèse → Studio Erregina (NICOLLE, DCB)
UPDATE etudiant
SET bien_id = (
  SELECT id FROM bien
  WHERE agence = 'dcb'
    AND (code ILIKE '%nicol%' OR hospitable_name ILIKE '%erregina%' OR hospitable_name ILIKE '%nicol%')
  LIMIT 1
)
WHERE agence = 'dcb' AND nom = 'Thèse' AND prenom = 'Adrien';

-- Vérification
SELECT e.nom, e.prenom, b.code, b.hospitable_name
FROM etudiant e
LEFT JOIN bien b ON b.id = e.bien_id
WHERE e.agence = 'dcb' AND e.nom = 'Thèse';
