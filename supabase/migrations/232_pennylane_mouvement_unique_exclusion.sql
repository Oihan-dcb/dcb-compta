-- Migration 232 : exclure les mouvements Pennylane du 2e index anti-doublon composite
--
-- `mouvement_unique` (date_operation, libelle, credit, debit, source) protège les imports
-- CSV contre les doublons de ré-import, mais exclut déjà Powens_% car ces lignes ont leur
-- propre dédup fiable via numero_operation = 'POWENS_'+id (index mouvement_bancaire_numero_operation_unique).
-- Les mouvements Pennylane utilisent le même principe (numero_operation = 'PENNYLANE_'+id),
-- donc même traitement : exclus du composite pour éviter qu'un faux positif (deux
-- transactions distinctes même jour/libellé/montant) fasse perdre une vraie ligne.

DROP INDEX IF EXISTS mouvement_unique;

CREATE UNIQUE INDEX mouvement_unique ON mouvement_bancaire (source, date_operation, libelle, credit, debit)
  WHERE source NOT LIKE 'Powens_%' AND source NOT LIKE 'Pennylane_%';
