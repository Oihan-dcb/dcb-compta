-- 250_mandat_lien_onboarding.sql
-- Onboarding propriétaire par LIEN public : le staff ne saisit que agence / Léa / honoraires /
-- contact, génère un lien, et le propriétaire complète lui-même sa fiche + celle du bien.
-- OTP vérifié AVANT toute saisie (le contact vient du staff), puis cascade
-- proprietaire → bien → proprietaire_onboarding → mandat_signature (via /api/generate-mandat).
-- Table séparée de mandat_signature volontairement : bien_id/proprietaire_id y sont NOT NULL et
-- structurants (mandat_signature_inflight_uq, mandat_sig_select, ProprioFiche.mandatFor), et une
-- session pré-mandat n'est pas un acte (pas de numero, pas de snapshot, pas de template).

create table if not exists mandat_lien (
  id                 uuid primary key default gen_random_uuid(),

  -- ── Paramètres posés par le staff à la génération du lien ──────────────────
  agence             text not null default 'dcb',
  secteur            text,                                    -- null = déduit de la ville du bien à la cascade
  bordeaux           boolean not null default false,          -- co-signature apporteur Léa Escudier (config.bordeaux)
  taux_commission    numeric,
  config             jsonb not null default '{}'::jsonb,
  contact_nom        text,
  contact_email      text,
  contact_tel        text,
  bien_nom           text,
  created_by         uuid references auth.users(id) on delete set null,

  -- ── Lien public ────────────────────────────────────────────────────────────
  token              uuid not null default gen_random_uuid(),
  token_expires_at   timestamptz not null default (now() + interval '14 days'),

  -- ── OTP (même pattern/nommage que mandat_signature, cf. migration 198) ─────
  canal              text,
  otp_hash           text,
  otp_expires_at     timestamptz,
  otp_sent_at        timestamptz,
  otp_verified_at    timestamptz,
  attempts           integer not null default 0,
  max_attempts       integer not null default 5,
  otp_send_count     integer not null default 0,
  session_key_hash   text,

  -- ── Saisies du propriétaire (brouillon auto-sauvegardé, avant cascade) ─────
  proprio_draft      jsonb not null default '{}'::jsonb,
  bien_draft         jsonb not null default '{}'::jsonb,

  -- ── Résultat de la cascade ─────────────────────────────────────────────────
  statut             text not null default 'cree',
  proprietaire_id    uuid references proprietaire(id) on delete set null,
  bien_id            uuid references bien(id) on delete set null,
  mandat_signature_id uuid references mandat_signature(id) on delete set null,
  dup_proprietaire_id uuid references proprietaire(id) on delete set null,
  dup_bien_id        uuid references bien(id) on delete set null,

  sent_at            timestamptz,
  completed_at       timestamptz,
  ip_address         text,
  user_agent         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint mandat_lien_statut_chk
    check (statut in ('cree','envoye','otp_verifie','complete','expire','annule')),
  constraint mandat_lien_agence_chk  check (agence in ('dcb','lauian')),
  constraint mandat_lien_canal_chk   check (canal is null or canal in ('sms','email')),
  constraint mandat_lien_secteur_chk check (secteur is null or secteur in ('cote-basque','bordeaux','bassin-arcachon')),
  constraint mandat_lien_contact_chk check (coalesce(contact_email,'') <> '' or coalesce(contact_tel,'') <> '')
);

create unique index if not exists mandat_lien_token_uq   on mandat_lien(token);
create index if not exists mandat_lien_statut_idx        on mandat_lien(statut);
create index if not exists mandat_lien_created_idx       on mandat_lien(created_at desc);

create or replace function set_mandat_lien_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_mandat_lien_updated_at on mandat_lien;
create trigger trg_mandat_lien_updated_at
  before update on mandat_lien
  for each row execute function set_mandat_lien_updated_at();

-- ── RLS : STAFF UNIQUEMENT. Le propriétaire n'a aucun compte à ce stade ; tous les
-- accès publics passent exclusivement par les endpoints service_role de dcb-contrats.
alter table mandat_lien enable row level security;
drop policy if exists mandat_lien_staff_all on mandat_lien;
create policy mandat_lien_staff_all on mandat_lien for all to authenticated
  using ( auth_user_is_staff() ) with check ( auth_user_is_staff() );

comment on table mandat_lien is
  'Session d''onboarding propriétaire par lien public (OTP-first). Le staff pose agence/Léa/honoraires/contact, le propriétaire complète sa fiche + celle du bien, puis cascade proprietaire→bien→proprietaire_onboarding→mandat_signature. RLS staff seul ; accès public via service_role (dcb-contrats/api/mandat-onb-*.js).';

-- rate_limit_hits / rate_limit_touch() existent déjà en prod (vérifié 09/09/2026) — pas recréés ici.
