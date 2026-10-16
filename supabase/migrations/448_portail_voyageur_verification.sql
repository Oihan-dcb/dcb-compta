-- 448 — PORTAIL VOYAGEUR : SÉCURITÉ (vérification par code), accompagnants, appareils reconnus, journal, chat (16/10/2026,
-- règles validées par Oïhan). PowerHouse : api/_portailVerif.js (vérification), api/_portailChat.js (chat des résas directes),
-- api/sejour.js (actions publiques), api/portail-voyageur.js (bureau : « couper l'accès », journal).
--
-- Règles :
--   - lien seul = infos NON sensibles ; adresse exacte, carte précise, codes, Wi-Fi, contrat, paiements = après code à 6 chiffres
--     (e-mail ou SMS au contact de la réservation, au choix du voyageur), valable 10 min, 5 essais ratés → blocage 30 min ;
--   - appareil reconnu 30 jours : cookie HttpOnly signé, LIÉ AU LIEN (un nouveau lien ou « couper l'accès » invalide tout) ;
--   - accompagnants ajoutés depuis une session vérifiée (contact chiffré AES-GCM, empreinte HMAC pour l'unicité) ;
--   - MODE ESSAI (PORTAIL_VOYAGEUR_MODE ≠ actif) : le code est affiché à l'écran, jamais envoyé (code.envoye = false) ;
--   - journal des vérifications et des consultations de données sensibles SANS IP complète (/24, /48) ;
--   - RLS sans politique : service_role seul (comme 442).

-- Lien créé dès la conversion d'une résa directe payée, AVANT que la résa soit synchronisée en base (webhook Hospitable) :
-- reservation_id rattaché ensuite (premier accès / création depuis le bureau) via resa_hospitable_id.
alter table public.portail_voyageur_lien alter column reservation_id drop not null;
alter table public.portail_voyageur_lien
  add column if not exists origine text,
  add column if not exists sessions_coupees_le timestamptz,
  add column if not exists sessions_coupees_par text,
  add column if not exists verif_bloque_jusqu timestamptz;
create unique index if not exists portail_voyageur_lien_hosp_attente_uniq
  on public.portail_voyageur_lien (resa_hospitable_id) where revoque_le is null and reservation_id is null;
alter table public.portail_voyageur_lien drop constraint if exists portail_voyageur_lien_resa_ou_hosp;
alter table public.portail_voyageur_lien add constraint portail_voyageur_lien_resa_ou_hosp check (reservation_id is not null or resa_hospitable_id is not null);

create table if not exists public.portail_voyageur_contact (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid not null references public.portail_voyageur_lien(id) on delete cascade,
  canal text not null check (canal in ('email', 'sms')),
  valeur_chiffree text not null,
  valeur_hash text not null check (valeur_hash ~ '^[0-9a-f]{64}$'),
  masque text,
  nom text,
  ajoute_par_session uuid,
  ajoute_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par text
);
create unique index if not exists portail_voyageur_contact_uniq on public.portail_voyageur_contact (lien_id, valeur_hash) where retire_le is null;
comment on table public.portail_voyageur_contact is 'Portail voyageur (448) : accompagnants ajoutés par le voyageur vérifié (contact chiffré AES-GCM, empreinte HMAC).';

create table if not exists public.portail_voyageur_code (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid not null references public.portail_voyageur_lien(id) on delete cascade,
  contact_id uuid references public.portail_voyageur_contact(id) on delete set null,
  role text not null default 'principal' check (role in ('principal', 'accompagnant')),
  canal text not null check (canal in ('email', 'sms', 'plateforme')),
  cible_masquee text,
  code_hash text not null,
  expire_le timestamptz not null,
  essais integer not null default 0,
  verifie_le timestamptz,
  remplace_le timestamptz,
  envoye boolean not null default false,
  essai boolean not null default true,
  apercu boolean not null default false,
  cree_le timestamptz not null default now()
);
create index if not exists portail_voyageur_code_lien_idx on public.portail_voyageur_code (lien_id, cree_le desc);
comment on table public.portail_voyageur_code is 'Portail voyageur (448) : codes de vérification (HMAC, jamais en clair), 10 min. envoye=false en mode essai (code affiché à l''écran).';

create table if not exists public.portail_voyageur_session (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid not null references public.portail_voyageur_lien(id) on delete cascade,
  contact_id uuid references public.portail_voyageur_contact(id) on delete set null,
  role text not null default 'principal',
  canal text,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  revoque_le timestamptz,
  revoque_par text,
  derniere_vue_le timestamptz,
  appareil text,
  ip_tronquee text,
  essai boolean not null default true
);
create index if not exists portail_voyageur_session_lien_idx on public.portail_voyageur_session (lien_id) where revoque_le is null;
comment on table public.portail_voyageur_session is 'Portail voyageur (448) : appareils reconnus 30 jours (cookie HttpOnly signé, lié au lien). « Couper l''accès » = revoque_le partout.';

create table if not exists public.portail_voyageur_evenement (
  id bigserial primary key,
  lien_id uuid not null references public.portail_voyageur_lien(id) on delete cascade,
  le timestamptz not null default now(),
  type text not null,
  session_id uuid,
  contact_id uuid,
  canal text,
  apercu boolean not null default false,
  ip_tronquee text,
  appareil text,
  detail jsonb
);
create index if not exists portail_voyageur_evenement_lien_idx on public.portail_voyageur_evenement (lien_id, le desc);
create index if not exists portail_voyageur_evenement_ko_idx on public.portail_voyageur_evenement (lien_id, le) where type = 'code_ko';
comment on table public.portail_voyageur_evenement is 'Portail voyageur (448) : journal des vérifications (code envoyé/affiché, réussi, raté, blocage), sessions, accompagnants, accès coupé, consultations de données sensibles. Sans IP complète. Purge proposée : 12 mois.';

create table if not exists public.portail_voyageur_message (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid references public.portail_voyageur_lien(id) on delete set null,
  reservation_id uuid references public.reservation(id) on delete cascade,
  session_id uuid,
  contact_id uuid,
  texte text not null check (length(texte) between 1 and 4000),
  essai boolean not null default true,
  hospitable_message_id bigint,
  cree_le timestamptz not null default now()
);
create index if not exists portail_voyageur_message_resa_idx on public.portail_voyageur_message (reservation_id, cree_le);
comment on table public.portail_voyageur_message is 'Portail voyageur (448) : messages écrits dans le chat du portail (résas directes). Mode actif : recopiés dans le fil (hospitable_messages, source=portail, id négatif) → Messagerie + brouillon IA. Essai : gardés ici seulement.';

alter table public.portail_voyageur_contact enable row level security;
alter table public.portail_voyageur_code enable row level security;
alter table public.portail_voyageur_session enable row level security;
alter table public.portail_voyageur_evenement enable row level security;
alter table public.portail_voyageur_message enable row level security;
revoke all on public.portail_voyageur_contact, public.portail_voyageur_code, public.portail_voyageur_session, public.portail_voyageur_evenement, public.portail_voyageur_message from anon, authenticated;
revoke all on sequence public.portail_voyageur_evenement_id_seq from anon, authenticated;
