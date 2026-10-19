-- 507 — Guide d'arrivée : budget IA du LOT séparé du travail interactif (19/10/2026, Oïhan bloqué par le lot).
alter table public.bien_arrivee_ia add column if not exists lot boolean not null default false;
-- Rattrapage : les appels du lot du 19/10/2026 ont été faits par le système (par = null).
update public.bien_arrivee_ia set lot = true where par is null and cree_le >= '2026-10-19';
create index if not exists bien_arrivee_ia_lot on public.bien_arrivee_ia (lot, cree_le desc);
