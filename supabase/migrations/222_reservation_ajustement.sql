-- Migration 222 : ajustements Hospitable (Resolution Center) sur une réservation.
--
-- Airbnb peut créditer/débiter une résa après coup (remboursement partiel, geste
-- commercial...) via un objet `financials.host.adjustments`. Impossible de savoir
-- automatiquement si ça touche l'hébergement (→ doit réduire commissionableBase,
-- cascade sur HON) ou le ménage/un extra (→ doit réduire uniquement fmenBase) :
-- le label Hospitable ("Resolution adjustment for resolution <id>") ne le dit pas.
--
-- Tant qu'un ajustement n'est pas qualifié (statut='a_qualifier'), il est ignoré
-- par le calcul de ventilation (comportement identique à avant cette migration)
-- et remonte comme alerte dans la matrice de contrôle (PageComptabilite).
-- Une fois qualifié par un humain, la résa est reventilée avec le bon traitement.

create table if not exists public.reservation_ajustement (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservation(id) on delete cascade,
  mois_comptable  text not null,
  montant         integer not null,        -- centimes, signé (positif = crédit, négatif = remboursement)
  label            text,                    -- label brut Hospitable
  type            text check (type in ('hebergement', 'menage')),
  statut          text not null default 'a_qualifier' check (statut in ('a_qualifier', 'traite')),
  qualifie_par    text,
  qualifie_le     timestamptz,
  created_at      timestamptz not null default now(),
  unique (reservation_id, label, montant)
);

create index if not exists reservation_ajustement_mois_idx on public.reservation_ajustement(mois_comptable);
create index if not exists reservation_ajustement_statut_idx on public.reservation_ajustement(statut);

alter table public.reservation_ajustement enable row level security;
drop policy if exists "anon_all_reservation_ajustement" on public.reservation_ajustement;
create policy "anon_all_reservation_ajustement" on public.reservation_ajustement for all using (true) with check (true);
