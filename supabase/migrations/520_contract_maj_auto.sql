-- 520 — Mise à jour automatique des contrats saisonniers NON SIGNÉS (21/10/2026, décision d'Oïhan)
--
-- Règle : quand un nouveau modèle de contrat devient actif (même agence / langue / type), les contrats ENVOYÉS non signés
-- dont l'arrivée est à venir sont régénérés sur ce modèle (même contrat, même lien de signature). Chaque mise à jour garde
-- ici la version d'AVANT (rendu HTML complet, modèle, PDF) et le tableau AVANT / APRÈS par article montré au voyageur
-- (mail « Votre contrat a été mis à jour » + encadré en tête de la page de signature) et au bureau (PowerHouse › Contrats).
-- Code : dcb-planning api/_contratMaj.js (logique + garde-fous), api/_contratDiff.js (calcul de l'avant / après, sans IA),
-- appelé chaque heure par api/cron-contract-monitor.js ; dcb-contrats api/session.js (encadré) et api/sign.js (refus de
-- signer une version périmée). Interrupteur Vercel CONTRAT_MAJ_AUTO : absent / « apercu » = mise à jour faite, AUCUN mail
-- (aperçu du mail gardé ici) ; « actif » = mail envoyé au voyageur ; « off » = rien.

create table if not exists public.contract_maj (
  id                   uuid primary key default gen_random_uuid(),
  contract_id          uuid not null references public.rental_contracts(id) on delete cascade,
  agence               text,
  langue               text,
  -- 'applique'  : contrat régénéré sur le nouveau modèle
  -- 'bloque_48h': arrivée dans moins de 48 h, rien changé, alerte à Oïhan
  -- 'erreur'    : régénération en échec (contrat inchangé)
  statut               text not null check (statut in ('applique','bloque_48h','erreur')),
  ancien_template_id   uuid,
  ancien_version       text,
  nouveau_template_id  uuid,
  nouvelle_version     text,
  -- Date où le voyageur a reçu la version d'avant (envoi du contrat, ou mise à jour précédente) : « reçue le JJ/MM/AAAA »
  ancien_recu_le       timestamptz,
  ancien_html          text,
  ancien_pdf_url       text,
  -- { articles: [{ cle, titre, type: 'modifie'|'ajoute'|'supprime', resume, avant: [..], apres: [..], paires: [..] }], nb_articles, gros }
  diff                 jsonb,
  -- Mail au voyageur : 'apercu' (interrupteur pas encore « actif » : rien envoyé, aperçu dans mail_apercu),
  -- 'envoye', 'echec', 'non_envoye' (décision du bureau, ex. lien transmis par Oïhan), null = pas de mail (statut ≠ applique)
  mail_statut          text check (mail_statut in ('apercu','envoye','echec','non_envoye')),
  mail_apercu          jsonb,           -- { a, sujet, html } tel qu'il serait / a été envoyé
  mail_envoye_le       timestamptz,
  mail_id              text,
  declencheur          text,            -- 'cron' | 'staff:<nom>' | 'manuel'
  erreur               text,
  created_at           timestamptz not null default now()
);

create index if not exists contract_maj_contract_idx on public.contract_maj (contract_id, created_at desc);

alter table public.contract_maj enable row level security;

drop policy if exists service_all on public.contract_maj;
create policy service_all on public.contract_maj for all to service_role using (true) with check (true);

drop policy if exists staff_select_contract_maj on public.contract_maj;
create policy staff_select_contract_maj on public.contract_maj for select to authenticated
  using (auth_user_is_bureau() or (auth_user_is_staff() and contract_id in (select rental_contracts.id from public.rental_contracts)));

comment on table public.contract_maj is 'Mises à jour automatiques des contrats non signés vers le modèle actif (520, 21/10/2026) : version d''avant + avant/après par article + mail.';
