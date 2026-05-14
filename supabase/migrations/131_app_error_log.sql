-- Logs d'erreurs automatiques (frontend + API).
-- INSERT : authenticated uniquement.
-- SELECT/UPDATE/DELETE : service_role uniquement (pas exposé au client).

CREATE TABLE IF NOT EXISTS app_error_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  app        text        NOT NULL,   -- 'compta' | 'portail-ae'
  route      text,                   -- window.location.pathname
  action     text,                   -- contexte (ex: 'ventilation.import', 'window.onerror')
  user_id    text,                   -- auth.uid() au moment de l'erreur
  agence     text,                   -- 'dcb' | 'lauian' | null
  message    text        NOT NULL,
  stack      text,                   -- tronqué à 500 chars
  metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE app_error_log ENABLE ROW LEVEL SECURITY;

-- Les utilisateurs authentifiés peuvent insérer leurs propres erreurs
CREATE POLICY "insert_authenticated" ON app_error_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- Pas de SELECT/UPDATE/DELETE depuis le client — inspection via Studio/service_role uniquement
