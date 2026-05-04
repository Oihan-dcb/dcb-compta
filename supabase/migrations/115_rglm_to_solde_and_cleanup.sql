-- Migration 115 : Correction architecture RGLM/SOLDE
-- Les lignes code='RGLM' créées par les migrations précédentes étaient en réalité
-- des SOLDE (solde restant à encaisser). On les renomme correctement.
-- Les vrais RGLM (paiements reçus) seront créés par _syncRglmSolde lors des prochaines liaisons.

UPDATE ventilation
SET
  code    = 'SOLDE',
  libelle = 'Solde à recevoir'
WHERE code = 'RGLM'
  AND calcul_source IN ('residuel', 'rapprochement');
