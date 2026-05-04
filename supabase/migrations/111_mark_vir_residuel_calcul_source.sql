-- Migration 111 : Marquer les lignes VIR résiduelles avec calcul_source='residuel'
-- Ces lignes ont un libelle contenant "(N)" (ex: "Virement propriétaire (2)")
-- et représentent des soldes de rapprochement partiel, pas des virements calculés.
-- buildRapportData les exclura désormais du calcul des rapports propriétaires.

UPDATE ventilation
SET calcul_source = 'residuel'
WHERE code = 'VIR'
  AND libelle ~ '\(\d+\)$'
  AND calcul_source = 'auto';
