-- 072_push_subscriptions.sql
-- Table pour stocker les abonnements Web Push des utilisateurs

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,   -- = ae_user_id / auth.uid()
  endpoint     text        NOT NULL UNIQUE,
  p256dh       text        NOT NULL,   -- clé publique chiffrée
  auth         text        NOT NULL,   -- clé d'authentification
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Lecture/écriture/suppression ouvertes (APIs internes sans JWT utilisateur)
CREATE POLICY "push_subscriptions_all" ON push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);
