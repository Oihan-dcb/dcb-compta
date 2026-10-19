-- 504 — Guide d'arrivée publié → page WordPress « Arrivée autonome » à la même adresse (19/10/2026, option 1 d'Oïhan).
-- bien_arrivee_source : date de bascule et id du brouillon WordPress de sauvegarde (l'ancien contenu reste dans WordPress).
-- bien_arrivee_wp_journal : chaque tentative (sauvegarde, publication, refus) — jamais de contenu de page ni de mot de passe.
alter table public.bien_arrivee_source add column if not exists wp_bascule_le timestamptz;
alter table public.bien_arrivee_source add column if not exists wp_sauvegarde_id integer;
create table if not exists public.bien_arrivee_wp_journal (
  id               uuid primary key default gen_random_uuid(),
  bien_id          uuid references public.bien(id) on delete set null,
  wp_page_id       integer,
  action           text not null check (action in ('sauvegarde', 'publication', 'refus')),
  ok               boolean not null default false,
  sauvegarde_wp_id integer,
  octets           integer,
  detail           jsonb,
  erreur           text,
  par              uuid,
  par_label        text,
  le               timestamptz not null default now()
);
comment on table public.bien_arrivee_wp_journal is 'Journal des écritures WordPress des pages « Arrivée autonome » (guide publié) — 504.';
alter table public.bien_arrivee_wp_journal enable row level security;
