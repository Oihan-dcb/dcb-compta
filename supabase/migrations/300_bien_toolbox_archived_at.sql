-- 300 — Archivage des fiches boîte à outils (04/10/2026, demande Oïhan : archiver plutôt que supprimer).
-- Fiche archivée = masquée des listes (PowerHouse, portail AE : boîte à outils, inventaire,
-- signalements, messagerie), données conservées. Appliquée en prod le 04/10/2026.
-- Archivées à la création : 6 anciennes fiches CSV sans bien (ASKUN, CARLTON, CHALET PALMARIA,
-- Chalet Plaisance, Potxoka / Playboy, TANDEM). Désarchiver : update ... set archived_at = null.

alter table public.bien_toolbox add column if not exists archived_at timestamptz;
comment on column public.bien_toolbox.archived_at is
  'Fiche archivée (ancien bien) : masquée des listes PowerHouse / portail AE, données conservées. 300 — 04/10/2026.';
