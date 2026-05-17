-- Migration 146 : table app_error_log — logging centralisé erreurs
-- Périmètre : frontend dcb-compta, frontend PowerHouse, edge functions, API routes Vercel

CREATE TABLE IF NOT EXISTS app_error_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  source       text        NOT NULL, -- 'frontend_compta' | 'frontend_powerhouse' | 'edge_<name>' | 'api_<name>'
  level        text        NOT NULL DEFAULT 'error' CHECK (level IN ('error', 'warn', 'info')),
  message      text        NOT NULL,
  stack        text,
  context      jsonb,      -- url, component, function_name, agence, etc.
  user_email   text,
  environment  text        NOT NULL DEFAULT 'production',
  resolved     boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_app_error_log_created_at ON app_error_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_error_log_source     ON app_error_log(source);
CREATE INDEX IF NOT EXISTS idx_app_error_log_resolved   ON app_error_log(resolved) WHERE resolved = false;

ALTER TABLE app_error_log ENABLE ROW LEVEL SECURITY;

-- Lecture : authenticated uniquement (admins dans dcb-compta)
CREATE POLICY "error_log_read" ON app_error_log
  FOR SELECT TO authenticated USING (true);

-- Écriture : service_role uniquement (edge functions + API routes)
-- Les frontends passent par /api/log-error (Vercel) qui utilise service_role
CREATE POLICY "error_log_insert_service" ON app_error_log
  FOR INSERT TO service_role WITH CHECK (true);
