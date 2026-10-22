-- 535 — Identifiant Hospitable de l'avis gardé par sync-reviews (22/10/2026).
-- Avant : « Publier » une réponse (PowerHouse › Avis › Répondre) relisait jusqu'à 4 pages de 100 avis du logement
-- chez Hospitable pour retrouver cet identifiant à chaque publication (lent). Il est désormais stocké à la synchro.
alter table public.reservation_review add column if not exists hospitable_review_id text;
create index if not exists reservation_review_hospitable_review_id_idx on public.reservation_review (hospitable_review_id);
