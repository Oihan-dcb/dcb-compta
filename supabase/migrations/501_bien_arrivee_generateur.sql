-- 501 — Générateur d'instructions d'arrivée autonome (PowerHouse, 19/10/2026, demande URGENTE d'Oïhan).
--
-- Un GUIDE D'ARRIVÉE par bien = une suite d'étapes structurées (pas de HTML figé), FR/EN/ES, avec parcours
-- (parking / piéton / transports…), photos, adresses, encadrés, et section départ. Rendu par un composant unique
-- (api/_arriveeRendu.js) dans le portail voyageur (onglet Arrivée), en aperçu staff et (plus tard) vers Hospitable.
--
-- SÉCURITÉ : AUCUN code d'accès, code de boîte à clés, digicode, mot de passe Wi-Fi n'est stocké dans ces tables.
-- Les textes ne contiennent que des CHAMPS SÉCURISÉS {{code_boite}}, {{digicode}}, {{wifi_nom}}, {{wifi_mdp}},
-- {{lien_arrivee}} résolus AU RENDU par le portail (fenêtre SB.accessWindows + vérification par code à 6 chiffres).
-- L'API refuse l'enregistrement d'un texte où une valeur secrète connue du bien apparaît en clair.
--
-- RLS activée SANS politique : lecture / écriture uniquement par le service (api/bien-arrivee.js, droits rejoués).

create table if not exists public.bien_arrivee (
  id           uuid primary key default gen_random_uuid(),
  bien_id      uuid not null references public.bien(id) on delete cascade,
  version      integer not null default 1,
  statut       text not null default 'brouillon' check (statut in ('brouillon', 'publie', 'archive')),
  contenu      jsonb not null default '{}'::jsonb,
  origine      text not null default 'manuel' check (origine in ('manuel', 'ia', 'modele', 'copie')),
  note         text,
  cree_par     uuid,
  cree_par_label text,
  cree_le      timestamptz not null default now(),
  modifie_le   timestamptz not null default now(),
  modifie_par  uuid,
  publie_le    timestamptz,
  publie_par   uuid,
  publie_par_label text
);
comment on table public.bien_arrivee is 'Guide d''arrivée autonome par bien (versions : un brouillon, une version publiée, archives = historique). Jamais de code en clair : champs sécurisés {{…}} résolus au rendu (501).';
create unique index if not exists bien_arrivee_un_brouillon on public.bien_arrivee (bien_id) where statut = 'brouillon';
create unique index if not exists bien_arrivee_un_publie on public.bien_arrivee (bien_id) where statut = 'publie';
create index if not exists bien_arrivee_bien_idx on public.bien_arrivee (bien_id, version desc);
alter table public.bien_arrivee enable row level security;

-- Sources d'origine reprises (ancienne page WordPress « Arrivée autonome », lue en LECTURE SEULE) — texte CAVIARDÉ :
-- les codes trouvés en clair sont remplacés par « [code présent dans la page WP] » avant tout enregistrement.
create table if not exists public.bien_arrivee_source (
  id           uuid primary key default gen_random_uuid(),
  bien_id      uuid references public.bien(id) on delete set null,
  origine      text not null default 'wordpress',
  wp_page_id   integer,
  slug         text,
  titre        text,
  lien         text,
  texte        text,           -- texte caviardé (aucun code)
  images       jsonb not null default '[]'::jsonb,  -- [{url, alt}]
  liens_maps   jsonb not null default '[]'::jsonb,
  code_present boolean not null default false,       -- la page WP contient au moins un code en clair (non recopié)
  champs_detectes text[] not null default '{}',     -- ex. {code_boite, wifi}
  wp_modifie_le timestamptz,
  importe_le   timestamptz not null default now(),
  unique (origine, wp_page_id)
);
comment on table public.bien_arrivee_source is 'Anciennes pages WP « Arrivée autonome » (lecture seule, texte caviardé : aucun code) — source de l''agent IA du guide d''arrivée (501).';
alter table public.bien_arrivee_source enable row level security;

-- Journal + cache des générations IA (à la demande, garde-fou serveur ; coût en $).
create table if not exists public.bien_arrivee_ia (
  id         uuid primary key default gen_random_uuid(),
  bien_id    uuid not null references public.bien(id) on delete cascade,
  mode       text not null check (mode in ('complet', 'etape')),
  empreinte  text not null,      -- md5 des faits + consigne : même empreinte = résultat servi depuis le cache
  resultat   jsonb,
  modele     text,
  cout_usd   numeric(10,6),
  par        uuid,
  cree_le    timestamptz not null default now()
);
create index if not exists bien_arrivee_ia_cache on public.bien_arrivee_ia (bien_id, mode, empreinte, cree_le desc);
create index if not exists bien_arrivee_ia_jour on public.bien_arrivee_ia (cree_le desc);
alter table public.bien_arrivee_ia enable row level security;

-- Photos ajoutées depuis l'éditeur (boîte à clés, entrée parking…) : bucket PUBLIC (le portail les affiche au voyageur),
-- écriture par le service seulement (api/bien-arrivee.js action « photo », image recompressée côté navigateur, 5 Mo max).
-- Ne jamais y mettre une photo où un code est lisible.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arrivee-photos', 'arrivee-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
