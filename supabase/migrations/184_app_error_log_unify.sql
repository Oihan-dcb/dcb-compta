-- Migration 184 — Unification app_error_log
-- Contexte :
--   131 a créé la table avec les colonnes : app, route, action, user_id, agence, message, stack, metadata
--   146 a tenté CREATE TABLE IF NOT EXISTS → no-op (table existait déjà)
--   Résultat : colonnes de 146 (source, level, context, user_email, environment, resolved) absentes
--   Les logs PowerHouse/API (qui utilisent source/level/context) tombent en silence (colonnes inconnues)
--
-- Fix :
--   1. Ajouter les colonnes de 146 manquantes
--   2. Nettoyer les policies conflictuelles
--   3. Ajouter les indexes de 146

-- ── Ajouter colonnes manquantes (idempotent) ─────────────────────────────────
ALTER TABLE app_error_log
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS level       text NOT NULL DEFAULT 'error',
  ADD COLUMN IF NOT EXISTS context     jsonb,
  ADD COLUMN IF NOT EXISTS user_email  text,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS resolved    boolean NOT NULL DEFAULT false;

-- Contrainte CHECK sur level (si pas déjà là)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'app_error_log_level_check'
  ) THEN
    ALTER TABLE app_error_log ADD CONSTRAINT app_error_log_level_check
      CHECK (level IN ('error', 'warn', 'info'));
  END IF;
END$$;

-- ── Indexes (idempotent via IF NOT EXISTS) ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_app_error_log_created_at ON app_error_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_log_source     ON app_error_log(source);
CREATE INDEX IF NOT EXISTS idx_app_error_log_resolved   ON app_error_log(resolved) WHERE resolved = false;

-- ── Nettoyage policies conflictuelles ───────────────────────────────────────
-- 131 avait : INSERT TO authenticated
-- 146 avait : INSERT TO service_role + SELECT TO authenticated
-- Les inserts frontend passent tous par /api/log-error (service_role) → supprimer authenticated INSERT

DROP POLICY IF EXISTS "insert_authenticated" ON app_error_log;
DROP POLICY IF EXISTS "error_log_read"           ON app_error_log;
DROP POLICY IF EXISTS "error_log_insert_service" ON app_error_log;

-- Policies finales propres
CREATE POLICY "error_log_insert_service" ON app_error_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "error_log_read_authenticated" ON app_error_log
  FOR SELECT TO authenticated USING (true);
