-- 288_contract_avenants.sql — Avenants aux contrats de location, signés électroniquement
--
-- 02/10/2026 (Oïhan) : rattacher par avenant des contrats signés sur des demandes de réservation
-- refusées puis renvoyées (Didier Maurer, Maison Maïté) et corriger un nombre de voyageurs.
-- Un avenant peut porter sur PLUSIEURS contrats (contract_ids). Envoi par PowerHouse
-- (api/avenant.js, e-mail + SMS), signature publique OTP dans dcb-contrats (api/avenant-sign.js,
-- /avenant?t=), même modèle de sécurité que bail_signataires (OTP + session_key hachée).
-- L'agence signe à l'envoi (staff authentifié qui déclenche l'envoi).

create table if not exists contract_avenants (
  id                uuid primary key default gen_random_uuid(),
  agence            text not null default 'dcb',
  contract_ids      uuid[] not null,
  numero            text,
  titre             text not null,
  contenu_html      text not null,
  statut            text not null default 'draft' check (statut in ('draft','sent','signed','cancelled')),
  signataire_nom    text,
  signataire_email  text,
  signataire_tel    text,
  token             uuid not null unique default gen_random_uuid(),
  canal             text,
  otp_hash          text,
  otp_expires_at    timestamptz,
  otp_sent_at       timestamptz,
  otp_verified_at   timestamptz,
  attempts          integer not null default 0,
  otp_send_count    integer not null default 0,
  session_key_hash  text,
  scroll_pct        integer,
  signature_name    text,
  signed_at         timestamptz,
  ip_address        text,
  user_agent        text,
  agence_signe_par  text,
  agence_signed_at  timestamptz,
  sent_at           timestamptz,
  pdf_signed_url    text,
  pdf_signed_hash   text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists contract_avenants_contracts_idx on contract_avenants using gin (contract_ids);

alter table contract_avenants enable row level security;
drop policy if exists contract_avenants_staff_all on contract_avenants;
create policy contract_avenants_staff_all on contract_avenants for all to authenticated
  using ( auth_user_is_staff() ) with check ( auth_user_is_staff() );
