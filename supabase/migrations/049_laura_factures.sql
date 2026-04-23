-- Migration 049 : table laura_facture
-- Factures de vente et tickets de caisse uploadés par Laura via le portail

create table if not exists laura_facture (
  id          uuid        primary key default gen_random_uuid(),
  agence      text        not null default 'dcb',
  type        text        not null default 'facture_vente',
  -- 'facture_vente' | 'ticket_caisse' | 'autre'
  libelle     text,
  montant     integer,    -- centimes, optionnel
  date        date,
  mois        text,       -- YYYY-MM, dénormalisé pour les requêtes par mois
  file_url    text,       -- chemin dans le bucket etudiant-documents
  created_at  timestamptz not null default now()
);

create index on laura_facture(agence, mois);

alter table laura_facture enable row level security;

create policy "anon_full_laura_facture" on laura_facture
  for all to anon using (true) with check (true);
