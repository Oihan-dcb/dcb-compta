-- 455 : « 🧹 Prix du ménage » (PowerHouse, 17/10/2026, demande d'Oïhan).
--
-- L'outil CALCULE et PROPOSE un prix de ménage par bien saisonnier ; il ne modifie JAMAIS un prix réel
-- (bien_frais / bien_tarification / Hospitable / Airbnb restent intouchés : Oïhan décide).
-- Formule (api/_prixMenage.js) : (main d'œuvre réelle + préparation des sacs + linge × lits + consommables) × 1,155.
--
-- 1. menage_prix_reglage : UNE ligne (id = 1) = les paramètres modifiables par Oïhan (taux de préparation, 45 €/lit,
--    consommables, coefficient, période, arrondi, nombre de lits forcé par bien…). Absente → défauts du code.
-- 2. menage_prix_proposition : « Proposer à Oïhan » = instantané de la proposition (paramètres + lignes calculées).
--    Simple enregistrement : aucun prix n'est changé.
-- Accès : uniquement via api/bien-mise-en-service.js (service_role, droits « perf » rejoués) → RLS sans policy.

create table if not exists public.menage_prix_reglage (
  id        smallint primary key default 1 check (id = 1),
  params    jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  maj_le    timestamptz not null default now(),
  maj_par   text
);
comment on table public.menage_prix_reglage is 'Prix du ménage (455) : paramètres de la formule (une seule ligne). Lu/écrit par api/bien-mise-en-service.js (w=menage).';

create table if not exists public.menage_prix_proposition (
  id        uuid primary key default gen_random_uuid(),
  cree_le   timestamptz not null default now(),
  cree_par  text,
  params    jsonb not null,
  lignes    jsonb not null check (jsonb_typeof(lignes) = 'array'),
  nb_biens  int not null default 0,
  note      text check (note is null or char_length(note) <= 1000),
  statut    text not null default 'proposee' check (statut in ('proposee', 'vue', 'traitee', 'abandonnee'))
);
create index if not exists menage_prix_proposition_cree_le on public.menage_prix_proposition (cree_le desc);
comment on table public.menage_prix_proposition is 'Prix du ménage (455) : propositions enregistrées par « Proposer à Oïhan ». Aucun effet sur les prix réels.';

alter table public.menage_prix_reglage enable row level security;
alter table public.menage_prix_proposition enable row level security;
revoke all on public.menage_prix_reglage from anon, authenticated;
revoke all on public.menage_prix_proposition from anon, authenticated;
