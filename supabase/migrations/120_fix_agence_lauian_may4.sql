-- Migration 120 : Re-tagger les 12 mouvements Lauian importés le 04/05/2026
-- Insérés avec agence='dcb' (DEFAULT) car importBanque.js n'ajoutait pas agence.
-- Bug corrigé dans le code. On corrige les données existantes.

UPDATE mouvement_bancaire
SET agence = 'lauian'
WHERE created_at >= '2026-05-04T00:00:00'
  AND created_at <  '2026-05-05T00:00:00'
  AND agence = 'dcb'
  AND mois_releve = '2026-04';
