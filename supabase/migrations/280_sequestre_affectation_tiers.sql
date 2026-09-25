-- Migration 280 : une affectation manuelle d'un mouvement du séquestre désigne aussi le tiers
-- (propriétaire / AE / agence) — boîte « À affecter » de la page Séquestre (25/09/2026).
ALTER TABLE public.sequestre_affectation
  ADD COLUMN IF NOT EXISTS tiers_type text,
  ADD COLUMN IF NOT EXISTS tiers_id   uuid;
