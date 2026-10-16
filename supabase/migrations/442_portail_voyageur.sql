-- 442 — PORTAIL VOYAGEUR (16/10/2026, feu vert d'Oïhan) : une page par séjour, lien unique non devinable, sans compte.
-- PowerHouse : api/_portailVoyageur.js (logique), api/sejour.js (page publique /sejour/<jeton>), api/portail-voyageur.js
-- (bureau : créer / copier / révoquer / aperçu / journal). Construit en MODE ESSAI : aucun lien n'est envoyé aux voyageurs,
-- paiements simulés, aucun envoi (mail, SMS, Hospitable, push).
--
-- Sécurité :
--   - le jeton (32 octets aléatoires, base64url) n'est JAMAIS stocké en clair : jeton_hash = SHA-256 (recherche) ;
--     jeton_chiffre = AES-256-GCM (clé dérivée de la clé serveur) pour que le bureau puisse réafficher / recopier le lien ;
--   - expiration = jour de départ + 30 jours (recalculée à chaque accès depuis la réservation), révocable (revoque_le) ;
--   - un seul lien actif par réservation (index unique partiel) ;
--   - RLS activée SANS politique : lecture / écriture uniquement par le serveur (service_role), jamais depuis un navigateur ;
--   - journal des consultations SANS IP complète (IPv4 /24, IPv6 /48) ni identifiant d'appareil.

create table if not exists public.portail_voyageur_lien (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservation(id) on delete cascade,
  resa_hospitable_id text,
  resa_code text,
  bien_id uuid references public.bien(id) on delete set null,
  agence text,
  jeton_hash text not null unique check (jeton_hash ~ '^[0-9a-f]{64}$'),
  jeton_chiffre text not null,
  langue text check (langue in ('fr', 'en', 'es')),
  expire_le timestamptz not null,
  revoque_le timestamptz,
  revoque_par text,
  revoque_motif text,
  cree_le timestamptz not null default now(),
  cree_par uuid,
  cree_par_label text,
  copie_le timestamptz,
  copie_par text,
  -- « Transmis au voyageur » : marqué À LA MAIN par le bureau (aucun envoi automatique n'existe).
  envoye_le timestamptz,
  envoye_par text,
  envoye_canal text,
  derniere_vue_le timestamptz,
  nb_vues integer not null default 0
);
create unique index if not exists portail_voyageur_lien_actif_uniq on public.portail_voyageur_lien (reservation_id) where revoque_le is null;
create index if not exists portail_voyageur_lien_resa_idx on public.portail_voyageur_lien (reservation_id);
comment on table public.portail_voyageur_lien is 'Portail voyageur (442) : lien unique par séjour. Jeton jamais en clair (hash SHA-256 + copie chiffrée AES-GCM pour le bureau).';

create table if not exists public.portail_voyageur_consultation (
  id bigserial primary key,
  lien_id uuid not null references public.portail_voyageur_lien(id) on delete cascade,
  le timestamptz not null default now(),
  apercu boolean not null default false,
  ip_tronquee text,
  appareil text,
  langue text,
  page text
);
create index if not exists portail_voyageur_consultation_lien_idx on public.portail_voyageur_consultation (lien_id, le desc);
comment on table public.portail_voyageur_consultation is 'Portail voyageur (442) : journal des consultations, sans IP complète (IPv4 /24, IPv6 /48). Purge proposée : 12 mois.';

create table if not exists public.portail_voyageur_commande (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid references public.portail_voyageur_lien(id) on delete set null,
  reservation_id uuid references public.reservation(id) on delete cascade,
  bien_id uuid references public.bien(id) on delete set null,
  agence text,
  lignes jsonb not null default '[]'::jsonb,
  total_centimes integer not null default 0 check (total_centimes >= 0),
  -- essai_simulee : paiement simulé (mode essai), rien de réel créé ; attente_bureau : demande transmise (paiement en
  -- ligne non branché) ; payee / appliquee : circuit réel (à brancher) ; annulee.
  statut text not null check (statut in ('essai_simulee', 'attente_bureau', 'payee', 'appliquee', 'echec', 'annulee')),
  essai boolean not null default true,
  plan jsonb,
  stripe_payment_intent_id text,
  cree_le timestamptz not null default now(),
  paye_le timestamptz,
  applique_le timestamptz
);
create index if not exists portail_voyageur_commande_resa_idx on public.portail_voyageur_commande (reservation_id);

create table if not exists public.portail_voyageur_signalement (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid references public.portail_voyageur_lien(id) on delete set null,
  reservation_id uuid references public.reservation(id) on delete cascade,
  bien_id uuid references public.bien(id) on delete set null,
  categorie text not null,
  urgent boolean not null default false,
  texte text not null,
  photo_url text,
  essai boolean not null default true,
  cible_table text,
  cible_id uuid,
  cree_le timestamptz not null default now()
);
create index if not exists portail_voyageur_signalement_resa_idx on public.portail_voyageur_signalement (reservation_id);

alter table public.portail_voyageur_lien enable row level security;
alter table public.portail_voyageur_consultation enable row level security;
alter table public.portail_voyageur_commande enable row level security;
alter table public.portail_voyageur_signalement enable row level security;
-- Aucune politique : seul le serveur (service_role) lit et écrit. Les écrans PowerHouse passent par api/portail-voyageur.js
-- (rôle PowerHouse + périmètre du bien vérifiés).
revoke all on public.portail_voyageur_lien, public.portail_voyageur_consultation, public.portail_voyageur_commande, public.portail_voyageur_signalement from anon, authenticated;
