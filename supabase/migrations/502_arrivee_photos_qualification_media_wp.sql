-- 502 — Guide d'arrivée : qualification des photos + envoi dans la Médiathèque WordPress (19/10/2026, demandes d'Oïhan).
--
-- bien_arrivee_photo : une ligne par photo candidate d'un bien (ancienne page WP, galerie de l'annonce, photo ajoutée).
--   L'IA propose un rôle (portail, boîte à clés, entrée parking…) ; quand c'est incertain, l'équipe répond à
--   « Cette photo montre quoi ? » → rôle + légende + étape MÉMORISÉS et réutilisés par tous les futurs brouillons.
--   code_visible : 'suspect' (l'IA voit peut-être un clavier, un cadenas à molettes, un papier avec un code) → la photo
--   n'est JAMAIS publiée sans validation explicite ('non') ; 'oui' → jamais utilisée.
-- bien_arrivee_media_wp : journal de chaque envoi vers la Médiathèque WordPress (ajout seulement, jamais de modification
--   ni de suppression de médias existants).
-- RLS activée sans politique (service seulement, api/bien-arrivee.js).

create table if not exists public.bien_arrivee_photo (
  id            uuid primary key default gen_random_uuid(),
  bien_id       uuid not null references public.bien(id) on delete cascade,
  url           text not null,
  origine       text not null default 'galerie' check (origine in ('page_wp', 'galerie', 'ajout', 'fiche')),
  statut        text not null default 'a_analyser' check (statut in ('a_analyser', 'a_qualifier', 'auto', 'qualifiee', 'ignoree')),
  role          text,
  legende       jsonb not null default '{}'::jsonb,   -- {fr, en, es}
  etape_id      text,
  code_visible  text not null default 'inconnu' check (code_visible in ('inconnu', 'suspect', 'non', 'oui')),
  ia            jsonb,          -- proposition IA : {role_probable, choix[], confiance, code_suspect, raison_code, legende}
  ia_le         timestamptz,
  qualifie_par  uuid,
  qualifie_par_label text,
  qualifie_le   timestamptz,
  wp_media_id   integer,
  cree_le       timestamptz not null default now(),
  unique (bien_id, url)
);
comment on table public.bien_arrivee_photo is 'Photos candidates du guide d''arrivée : rôle / légende / étape qualifiés (IA puis équipe), code visible ? (suspect = jamais publié sans validation) — 502.';
create index if not exists bien_arrivee_photo_bien on public.bien_arrivee_photo (bien_id, statut);
alter table public.bien_arrivee_photo enable row level security;

create table if not exists public.bien_arrivee_media_wp (
  id           uuid primary key default gen_random_uuid(),
  bien_id      uuid references public.bien(id) on delete set null,
  fichier      text not null,
  wp_media_id  integer,
  wp_url       text,
  stockage_url text,
  octets       integer,
  etape_id     text,
  erreur       text,
  par          uuid,
  par_label    text,
  cree_le      timestamptz not null default now()
);
comment on table public.bien_arrivee_media_wp is 'Journal des photos du guide d''arrivée envoyées dans la Médiathèque WordPress (ajout seulement) — 502.';
alter table public.bien_arrivee_media_wp enable row level security;

-- Journal IA : mode « photos » (analyse des photos candidates).
alter table public.bien_arrivee_ia drop constraint if exists bien_arrivee_ia_mode_check;
alter table public.bien_arrivee_ia add constraint bien_arrivee_ia_mode_check check (mode in ('complet', 'etape', 'photos'));
