-- 489 — Accueil › « À faire » (19/10/2026, demande Oïhan) : une demande Airbnb restée « request » en base
-- (expirée côté Airbnb, ou déjà traitée) peut être marquée « expirée » / « traitée » CÔTÉ POWERHOUSE seulement.
-- Rien n'est écrit dans Hospitable ni dans reservation : la ligne disparaît de « À faire » tant que la demande
-- garde les mêmes dates (empreinte = id résa|arrivée|départ) ; si les dates changent, elle revient.
-- Écrit par api/dashboard.js (POST w=afaire_action, service role) ; lu par api/_aFaire.js. Journal = la table.
create table if not exists public.afaire_traite (
  id          uuid primary key default gen_random_uuid(),
  genre       text not null check (genre in ('demande_airbnb')),
  ref         text not null,                 -- reservation.id
  empreinte   text not null,                 -- id|arrivée|départ au moment du geste
  statut      text not null check (statut in ('expiree', 'traitee')),
  motif       text,
  par_id      uuid,
  par_nom     text,
  cree_le     timestamptz not null default now()
);
create index if not exists afaire_traite_ref on public.afaire_traite (genre, ref);
alter table public.afaire_traite enable row level security;
-- Aucune politique : accès service role uniquement (API PowerHouse).
comment on table public.afaire_traite is 'À faire (PowerHouse) : demandes Airbnb marquées expirées / traitées côté PowerHouse (489). Journal des gestes.';
