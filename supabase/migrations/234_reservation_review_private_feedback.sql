-- Migration 234 — capture le feedback privé Hospitable (jamais public, souvent plus franc)
-- et les notes détaillées par catégorie sur reservation_review. Utilisés par la future
-- synthèse "axes d'amélioration" par bien dans PowerHouse.
alter table public.reservation_review
  add column if not exists private_feedback text,
  add column if not exists detailed_ratings jsonb;
