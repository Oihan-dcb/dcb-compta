-- Migration 119 : Corriger agence=null sur les mouvements importés pour Lauian
-- importBanque.js n'ajoutait pas le champ agence (bug corrigé).
-- Les mouvements sans agence du CSV Lauian ont source='CaisseEpargne'.
-- On les attribue à 'lauian' si agence IS NULL et s'ils ne correspondent
-- à aucun mouvement DCB existant sur le même mois.
-- Sécurité : on ne touche que les lignes agence IS NULL.

UPDATE mouvement_bancaire
SET agence = 'lauian'
WHERE agence IS NULL
  AND source = 'CaisseEpargne'
  AND mois_releve = '2026-04';
