-- Onboarding + contrat de prestation des auto-entrepreneurs (AE).
-- Réplique le flow mandat proprio, mais la signature se fait DANS le portail AE
-- (l'AE est déjà authentifié → identité prouvée par la connexion, pas d'OTP/selfie).
-- Génération auto après questionnaire ; non bloquant.

-- ── 1. Questionnaire d'onboarding AE ────────────────────────────────────────
create table if not exists public.ae_onboarding (
  ae_id          uuid primary key references public.auto_entrepreneur(id) on delete cascade,
  reponses       jsonb not null default '{}'::jsonb,
  doc_kbis_path        text,   -- extrait K-bis / justificatif SIRET
  doc_assurance_path   text,   -- attestation responsabilité civile pro
  doc_rib_path         text,   -- RIB / IBAN
  doc_identite_path    text,   -- pièce d'identité
  complete_le    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── 2. Contrat de prestation AE (génération + signature intégrée) ────────────
create table if not exists public.ae_contrat (
  id               uuid primary key default gen_random_uuid(),
  agence           text not null default 'dcb',           -- dcb | lauian
  ae_id            uuid not null references public.auto_entrepreneur(id) on delete cascade,
  template_id      uuid references public.contract_templates(id),
  template_version text,
  numero           text unique,                            -- PRESTAE-YYYY-####
  config           jsonb not null default '{}'::jsonb,     -- penalite, preavis, non_solicit_jours…
  ae_snapshot      jsonb,                                  -- figé : désignation, siret, tel, email, adresse…
  agence_snapshot  jsonb,
  contenu_html_rendered text,
  pdf_draft_url    text,
  pdf_draft_hash   text,
  pdf_signed_url   text,
  pdf_signed_hash  text,
  statut           text not null default 'pret'            -- pret | signe | annule | remplace
                     check (statut in ('pret','signe','annule','remplace')),
  -- Signature (légère : connexion = identité)
  signature_name   text,
  signature_canvas text,
  scroll_pct       int,
  clauses_accepted jsonb,
  ip_address       text,
  user_agent       text,
  signed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Un seul contrat "actif" (pret|signe) par AE.
create unique index if not exists ae_contrat_one_active
  on public.ae_contrat(ae_id) where statut in ('pret','signe');
create index if not exists ae_contrat_ae_idx on public.ae_contrat(ae_id);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
alter table public.ae_onboarding enable row level security;
alter table public.ae_contrat   enable row level security;

-- Helper inline : l'AE courant (via ae_user_id = auth.uid())
-- Onboarding : l'AE gère sa propre ligne.
drop policy if exists ae_onboarding_own on public.ae_onboarding;
create policy ae_onboarding_own on public.ae_onboarding for all to authenticated
  using (ae_id in (select id from public.auto_entrepreneur where ae_user_id = auth.uid()))
  with check (ae_id in (select id from public.auto_entrepreneur where ae_user_id = auth.uid()));

-- Contrat : l'AE lit le sien (écritures = service_role via les endpoints de génération/signature).
drop policy if exists ae_contrat_select_own on public.ae_contrat;
create policy ae_contrat_select_own on public.ae_contrat for select to authenticated
  using (ae_id in (select id from public.auto_entrepreneur where ae_user_id = auth.uid()));

-- ── 4. Buckets Storage (privés ; docs uploadés par l'AE, PDF générés service_role) ──
insert into storage.buckets (id, name, public) values ('ae-onboarding','ae-onboarding', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('ae-contrats','ae-contrats', false)
  on conflict (id) do nothing;

-- L'AE peut déposer/lire ses propres documents d'onboarding (préfixe = son ae_id).
drop policy if exists ae_onboarding_obj_rw on storage.objects;
create policy ae_onboarding_obj_rw on storage.objects for all to authenticated
  using (
    bucket_id = 'ae-onboarding'
    and (storage.foldername(name))[1] in (select id::text from public.auto_entrepreneur where ae_user_id = auth.uid())
  )
  with check (
    bucket_id = 'ae-onboarding'
    and (storage.foldername(name))[1] in (select id::text from public.auto_entrepreneur where ae_user_id = auth.uid())
  );
