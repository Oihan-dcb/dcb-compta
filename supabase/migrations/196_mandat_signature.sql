-- Phase 2.1 — Mandat d'administration signable PAR BIEN (signature interne OTP SMS + fallback email).
-- Table unique : porte les données du mandat ET l'état de signature (flux simple, 1 proprio = 1 signature).
-- Le template vit dans contract_templates (type_contrat='mandat_administration'). Legacy mandat_gestion conservé tel quel.

create table if not exists mandat_signature (
  id                 uuid primary key default gen_random_uuid(),
  agence             text not null,
  bien_id            uuid not null references bien(id) on delete cascade,
  proprietaire_id    uuid not null references proprietaire(id) on delete cascade,
  template_id        uuid references contract_templates(id),
  template_version   text,
  numero             text unique,                         -- ex. MAND-2026-0042

  -- Paramètres variables (durée, taux, options conditionnelles : residence_principale, location_chambre, execution_immediate, limite_jours…)
  config             jsonb not null default '{}'::jsonb,
  -- Snapshots figés à la génération (intégrité de l'acte)
  mandant_snapshot   jsonb not null default '{}'::jsonb,
  bien_snapshot      jsonb not null default '{}'::jsonb,
  agence_snapshot    jsonb not null default '{}'::jsonb,
  contenu_html_rendered text,

  -- PDF (bucket privé "mandats")
  pdf_draft_url      text,
  pdf_draft_hash     text,
  pdf_signed_url     text,
  pdf_signed_hash    text,

  -- Cycle de vie
  statut             text not null default 'brouillon',   -- brouillon|envoye|signe|refuse|expire|annule|remplace
  date_effet         date,
  date_echeance      date,

  -- Session de signature (intégrée)
  sign_token         uuid default gen_random_uuid(),
  sign_slug          text unique,                          -- short URL publique
  token_expires_at   timestamptz,
  canal              text,                                 -- 'sms' | 'email'
  phone_verified     boolean not null default false,
  otp_sent_at        timestamptz,
  otp_verified_at    timestamptz,
  attempts           integer not null default 0,
  max_attempts       integer not null default 5,
  scroll_pct         integer,
  clauses_accepted   jsonb,
  signature_canvas   text,
  ip_address         text,
  user_agent         text,

  sent_at            timestamptz,
  signed_at          timestamptz,
  refused_at         timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint mandat_signature_statut_chk
    check (statut in ('brouillon','envoye','signe','refuse','expire','annule','remplace')),
  constraint mandat_signature_canal_chk
    check (canal is null or canal in ('sms','email'))
);

-- Un seul mandat "en cours" (brouillon/envoyé) par bien ; les signés/historiques cohabitent (renouvellements).
create unique index if not exists mandat_signature_inflight_uq
  on mandat_signature(bien_id) where statut in ('brouillon','envoye');

create index if not exists mandat_signature_bien_idx on mandat_signature(bien_id);
create index if not exists mandat_signature_proprio_idx on mandat_signature(proprietaire_id);
create index if not exists mandat_signature_statut_idx on mandat_signature(statut);

-- updated_at auto
create or replace function set_mandat_signature_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_mandat_signature_updated_at on mandat_signature;
create trigger trg_mandat_signature_updated_at
  before update on mandat_signature
  for each row execute function set_mandat_signature_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table mandat_signature enable row level security;

-- Lecture : staff (dcb-compta / PowerHouse) OU le propriétaire pour ses biens
create policy mandat_sig_select on mandat_signature for select to authenticated
  using ( auth_user_is_staff() or proprietaire_id in (select my_proprietaire_ids()) );

-- Écriture réservée au staff (la signature publique passe par edge function service_role)
create policy mandat_sig_staff_all on mandat_signature for all to authenticated
  using ( auth_user_is_staff() ) with check ( auth_user_is_staff() );

-- ── Storage : PDF des mandats (brouillon + signé) ──────────────────────────
insert into storage.buckets (id, name, public)
values ('mandats', 'mandats', false)
on conflict (id) do nothing;

-- Chemin = <proprietaire_id>/<bien_id>/<numero>-(draft|signed).pdf
create policy mandat_obj_select on storage.objects for select to authenticated
  using ( bucket_id = 'mandats' and (
    auth_user_is_staff() or (storage.foldername(name))[1] in (select my_proprietaire_ids()::text)
  ));
create policy mandat_obj_insert on storage.objects for insert to authenticated
  with check ( bucket_id = 'mandats' and auth_user_is_staff() );
create policy mandat_obj_update on storage.objects for update to authenticated
  using ( bucket_id = 'mandats' and auth_user_is_staff() );
