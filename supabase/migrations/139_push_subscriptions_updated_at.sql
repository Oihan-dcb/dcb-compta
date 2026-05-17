-- Migration 139 : owner_push_subscriptions — colonne updated_at manquante
-- La table a été créée directement en session (pas via migration fichier).
-- Ce fichier documente l'état réel de la table + ajoute updated_at.
ALTER TABLE owner_push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
