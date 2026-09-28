-- 287_bail_mobilite.sql — Bail mobilité (loi 89-462, titre Ier ter, art. 25-12 et s.) dans PowerHouse
--
-- 28/09/2026 (Oïhan) — cas déclencheur : production audiovisuelle tiers payant + locataire
-- personne physique en mission temporaire, 1 mois. Conception :
--   1. Toute résa ≥ 1 mois calendaire (≤ 10 mois) génère un brouillon MIS EN ATTENTE
--      (hold_reason='duree_longue') : jamais d'envoi auto, le staff qualifie saisonnier/mobilité.
--   2. Bail mobilité = même ligne rental_contracts (visible onglet Contrats, lié à la résa),
--      type_contrat='mobilite', données de l'acte dans bail_data (parties + conditions + logement).
--   3. bail_lien : questionnaire public OTP-first (calqué sur mandat_lien) rempli par un
--      « déclarant » (ex. assistante de production) — les parties re-confirment à la signature.
--   4. bail_signataires : une ligne par signataire (locataire(s), représentant du payeur,
--      agence), chacun son token + OTP + pièce d'identité + signature.
-- Aucun dépôt de garantie possible (art. 25-15) → jamais de Stripe sur ce type.

-- ── 1. rental_contracts ──────────────────────────────────────────────────────
alter table rental_contracts
  add column if not exists type_contrat text not null default 'saisonnier',
  add column if not exists hold_reason  text,
  add column if not exists bail_data    jsonb not null default '{}'::jsonb;

alter table rental_contracts drop constraint if exists rental_contracts_type_contrat_check;
alter table rental_contracts add constraint rental_contracts_type_contrat_check
  check (type_contrat in ('saisonnier','mobilite'));

comment on column rental_contracts.type_contrat is
  'saisonnier (tunnel historique contract_sign_sessions + Stripe) | mobilite (bail_signataires, aucun dépôt de garantie).';
comment on column rental_contracts.hold_reason is
  'Non NULL = brouillon en attente de qualification staff, envoi (auto ou manuel) refusé. duree_longue = séjour ≥ 1 mois calendaire.';
comment on column rental_contracts.bail_data is
  'Bail mobilité : { motif, motif_detail, locataires[], payeur{}, contacts_cc[], conditions{}, logement{} } — voir dcb-planning/api/_bailMobilite.js.';

-- ── 2. bail_lien (questionnaire des parties, OTP-first) ──────────────────────
create table if not exists bail_lien (
  id                uuid primary key default gen_random_uuid(),
  contract_id       uuid not null references rental_contracts(id) on delete cascade,
  token             uuid not null unique default gen_random_uuid(),
  token_expires_at  timestamptz not null default (now() + interval '14 days'),
  contact_nom       text,
  contact_email     text,
  contact_tel       text,
  canal             text,
  otp_hash          text,
  otp_expires_at    timestamptz,
  otp_sent_at       timestamptz,
  otp_verified_at   timestamptz,
  attempts          integer not null default 0,
  max_attempts      integer not null default 5,
  otp_send_count    integer not null default 0,
  session_key_hash  text,
  draft             jsonb not null default '{}'::jsonb,
  statut            text not null default 'cree'
                    check (statut in ('cree','envoye','otp_verifie','complete','annule')),
  sent_at           timestamptz,
  completed_at      timestamptz,
  created_by        uuid,
  ip_address        text,
  user_agent        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists bail_lien_contract_idx on bail_lien(contract_id);

-- ── 3. bail_signataires ──────────────────────────────────────────────────────
create table if not exists bail_signataires (
  id                   uuid primary key default gen_random_uuid(),
  contract_id          uuid not null references rental_contracts(id) on delete cascade,
  role                 text not null check (role in ('locataire','payeur','agence')),
  ordre                integer not null default 0,
  civilite             text,
  nom                  text,
  prenom               text,
  qualite              text,
  societe              text,
  email                text,
  telephone            text,
  token                uuid not null unique default gen_random_uuid(),
  canal                text,
  otp_hash             text,
  otp_expires_at       timestamptz,
  otp_sent_at          timestamptz,
  otp_verified_at      timestamptz,
  attempts             integer not null default 0,
  otp_send_count       integer not null default 0,
  session_key_hash     text,
  id_document_path     text,
  id_document_taken_at timestamptz,
  signature_name       text,
  paraphe              text,
  clauses_accepted     jsonb not null default '{}'::jsonb,
  scroll_pct           integer,
  signed_at            timestamptz,
  ip_address           text,
  user_agent           text,
  sent_at              timestamptz,
  statut               text not null default 'actif' check (statut in ('actif','revoque')),
  created_at           timestamptz not null default now()
);
create index if not exists bail_signataires_contract_idx on bail_signataires(contract_id);

-- ── 4. RLS : STAFF UNIQUEMENT (accès public via service_role, dcb-contrats/api/bail-*.js) ──
alter table bail_lien enable row level security;
drop policy if exists bail_lien_staff_all on bail_lien;
create policy bail_lien_staff_all on bail_lien for all to authenticated
  using ( auth_user_is_staff() ) with check ( auth_user_is_staff() );

alter table bail_signataires enable row level security;
drop policy if exists bail_signataires_staff_all on bail_signataires;
create policy bail_signataires_staff_all on bail_signataires for all to authenticated
  using ( auth_user_is_staff() ) with check ( auth_user_is_staff() );

-- ── 5. Bucket privé : justificatifs de motif, Kbis/pouvoir, pièces d'identité, PDF signés ──
insert into storage.buckets (id, name, public) values ('baux','baux', false)
  on conflict (id) do nothing;
