-- 363 — Agent IA voyageurs PowerHouse : descriptif complet de l'annonce Hospitable (08/10/2026, Oïhan).
-- Copie locale des textes marketing de l'annonce (GET /v2/properties/{uuid}?include=details),
-- rafraîchie par le cron quotidien api/ga-sync-practical-faq.js (dcb-planning) — l'agent ne
-- rappelle jamais Hospitable par message. Injecté dans le prompt en PRIORITÉ BASSE (peut être
-- périmé ; fiches PowerHouse / FAQ / Knowledge Hub priment). Cas d'origine : 416, « l'arrêt de
-- bus est situé juste au pied de la résidence pour les transferts aéroport/gare ».
-- Pas de wifi ici (secrets : déjà gérés par bien_faq_pratique + custom codes, gate J-1).
-- Additif uniquement.
create table if not exists public.bien_annonce_descriptif (
  bien_id uuid primary key references public.bien(id) on delete cascade,
  agence text,
  hospitable_id text,
  public_name text,
  summary text,
  description text,
  space_overview text,
  guest_access text,
  house_manual text,
  other_details text,
  additional_rules text,
  neighborhood_description text,
  getting_around text,
  checkin text,
  checkout text,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bien_annonce_descriptif is 'Textes de l''annonce Hospitable (summary, description, details.*) — source marketing, priorité basse pour l''agent IA voyageurs ; sync quotidienne ga-sync-practical-faq';

-- Lecture/écriture serveur uniquement (service_role) : RLS activée sans policy.
alter table public.bien_annonce_descriptif enable row level security;

-- Rollback :
-- drop table if exists public.bien_annonce_descriptif;
