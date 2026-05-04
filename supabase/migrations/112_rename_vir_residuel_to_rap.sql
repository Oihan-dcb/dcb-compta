-- Migration 112 : Renommer les lignes VIR résiduelles en RAP
-- Ces lignes tracent le solde bancaire restant à encaisser depuis le voyageur
-- pour les réservations manual (virements directs) et direct (Stripe multi-versements).
-- Elles n'ont rien à faire dans les rapports propriétaires ni les exports financiers.
--
-- Critères de sécurité (double condition pour ne toucher que les résiduels) :
--   - calcul_source = 'residuel'  → marqué par migration 111 ou par ventilation.js
--   - libelle ~ '\(\d+\)$'        → pattern "Virement propriétaire (N)" des anciens résiduels
--
-- Les VIR réels (virement proprio = LOY + taxe) ont :
--   - calcul_source = 'auto'
--   - libelle = 'Virement propriétaire' (sans suffixe numérique)
-- Ils ne seront jamais touchés.

UPDATE ventilation
SET
  code    = 'RAP',
  libelle = 'Solde bancaire à rapprocher'
WHERE code = 'VIR'
  AND calcul_source = 'residuel'
  AND libelle ~ '\(\d+\)$';
