-- 420 — Vente directe (14/10/2026) :
--  1) cache des traductions automatiques EN/ES des textes publics (Haiku, À L'ENREGISTREMENT seulement),
--     clé = empreinte md5 du texte français normalisé (même principe que bien_savoir.en_empreinte) ;
--  2) mode ESSAI par bien (staff connecté seulement, parcours simulé : aucun débit, aucune résa, aucun envoi) ;
--  3) journal des essais (direct_evenement type 'essai').
create table if not exists public.direct_traduction (
  empreinte text not null check (empreinte ~ '^[a-f0-9]{32}$'),
  langue text not null check (langue in ('en','es')),
  texte text not null,
  cout_usd numeric,
  cree_le timestamptz not null default now(),
  primary key (empreinte, langue)
);
alter table public.direct_traduction enable row level security; -- service role uniquement

alter table public.bien_vente_directe add column if not exists essai boolean not null default false;
alter table public.bien_vente_directe add column if not exists essai_le timestamptz;
alter table public.bien_vente_directe add column if not exists essai_par text;
comment on column public.bien_vente_directe.essai is 'Mode essai : page/widgets visibles seulement par un membre du bureau connecté (jeton signé émis par api/direct-gestion), parcours simulé (aucun débit, aucune résa Hospitable, aucun envoi). Ignoré si active=true.';

alter table public.direct_evenement drop constraint if exists direct_evenement_type_check;
alter table public.direct_evenement add constraint direct_evenement_type_check check (type = any (array['vue','devis','reservation','demande','refus','abus','essai']));
