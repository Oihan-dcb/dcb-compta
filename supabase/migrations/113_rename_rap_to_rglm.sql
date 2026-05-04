-- Migration 113 : Renommer code RAP → RGLM (Règlement voyageur)
-- RGLM est sémantiquement plus juste : la ligne représente un montant
-- attendu du voyageur, pas l'action de rapprochement elle-même.

UPDATE ventilation
SET code = 'RGLM'
WHERE code = 'RAP'
  AND calcul_source = 'residuel';
