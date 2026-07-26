-- import_log n'avait pas de colonne agence : tous les badges "Dernier sync" (LastSyncBadge,
-- filtré uniquement par `type`) affichaient indifféremment le dernier run DCB ou Lauian,
-- selon celui qui avait tourné en dernier. Découvert le 26/07/2026 : lauian-compta affichait
-- le sync Pennylane de DCB alors que Lauian n'a pas encore de token Pennylane (tâche #5).
ALTER TABLE import_log ADD COLUMN IF NOT EXISTS agence text;
CREATE INDEX IF NOT EXISTS idx_import_log_type_agence ON import_log (type, agence, created_at DESC);
