-- 470 — DÉPART TARDIF NON AUTORISÉ : journal des pénalités constatées (bouton « ⏰ Départ tardif non autorisé » de la
-- fiche du séjour PowerHouse, api/penalite-depart.js ; règle de calcul unique api/_penaliteDepart.js — décision d'Oïhan
-- du 17/10/2026 : tolérance 10 min, 10 % du prix moyen d'une nuit par tranche de 10 min commencée, plafond une nuit,
-- + frais réels justifiés).
-- Une ligne par constat (plusieurs possibles si le premier est annulé). Paramètres FIGÉS au moment du constat (heure
-- prévue, heure constatée, prix de la nuit, calcul complet).
-- Modes : 'essai' (interrupteur Vercel PENALITE_DEPART_DEBIT absent : calcul + enregistrement, AUCUN débit),
--         'debit' (réservation directe avec carte de garantie, interrupteur actif : débit via la passerelle dcb-contrats),
--         'plateforme' (Airbnb / Booking : texte de réclamation prêt à copier, rien envoyé),
--         'manuel' (directe sans carte de garantie débitable : à facturer / encaisser à la main).
-- COMPTA : NON TRANCHÉ (revenu agence ou propriétaire ? question posée à Oïhan) → compta_statut = 'en_attente_decision'
-- partout ; aucune ligne de ventilation, aucun effet sur HON / LOY / VIRProprio tant qu'Oïhan n'a pas décidé.
-- Écriture serveur seulement (service role) ; lecture staff.
-- APPLIQUÉE le 17/10/2026 (MCP apply_migration).

create table if not exists public.penalite_depart (
  id                        uuid primary key default gen_random_uuid(),
  reservation_id            uuid not null references public.reservation(id) on delete restrict,
  reservation_code          text,
  bien_id                   uuid references public.bien(id) on delete set null,
  agence                    text not null default 'dcb' check (agence in ('dcb', 'lauian')),
  plateforme                text,
  contrat_id                uuid,
  date_depart               date not null,
  heure_prevue              text not null,                       -- « HH:MM » heure effective du séjour (reservation_heure_v)
  heure_source              text,                                -- vendue | bien | hospitable | defaut
  constate_le               timestamptz not null,                -- instant réel du départ constaté
  retard_min                integer not null default 0 check (retard_min >= 0),
  tranches                  integer not null default 0 check (tranches >= 0),
  prix_nuit_centimes        integer not null default 0 check (prix_nuit_centimes >= 0),
  penalite_centimes         integer not null default 0 check (penalite_centimes >= 0),
  frais_reels               jsonb not null default '[]'::jsonb,  -- [{ montant_cts, motif }]
  frais_reels_centimes      integer not null default 0 check (frais_reels_centimes >= 0),
  total_centimes            integer not null default 0 check (total_centimes >= 0),
  calcul                    jsonb not null,
  mode                      text not null check (mode in ('essai', 'debit', 'plateforme', 'manuel')),
  statut                    text not null default 'enregistree' check (statut in ('enregistree', 'debit_en_cours', 'debitee', 'debit_echec', 'reclamation_preparee', 'annulee')),
  stripe_payment_intent_id  text,
  debit                     jsonb,                               -- réponse passerelle (statut, carte, erreur)
  texte_reclamation         text,
  note                      text,
  compta_statut             text not null default 'en_attente_decision' check (compta_statut in ('en_attente_decision', 'agence', 'proprietaire', 'partage', 'sans_objet')),
  verrou_le                 timestamptz,
  cree_par                  uuid,
  cree_par_label            text,
  cree_le                   timestamptz not null default now(),
  annule_le                 timestamptz,
  annule_par_label          text,
  maj_le                    timestamptz not null default now(),
  check (total_centimes = penalite_centimes + frais_reels_centimes)
);
create index if not exists penalite_depart_resa_idx on public.penalite_depart (reservation_id);
-- Un seul débit / constat actif à la fois par réservation (les constats annulés restent au journal).
create unique index if not exists penalite_depart_une_active on public.penalite_depart (reservation_id) where statut <> 'annulee';
comment on table public.penalite_depart is 'Départs tardifs non autorisés constatés (470) : calcul figé, mode essai/debit/plateforme/manuel, débit carte de garantie via passerelle dcb-contrats. Compta en attente de décision d''Oïhan (agence ou propriétaire). Écriture serveur seulement.';

alter table public.penalite_depart enable row level security;
drop policy if exists penalite_depart_lecture on public.penalite_depart;
create policy penalite_depart_lecture on public.penalite_depart for select to authenticated using (auth_user_is_staff());
revoke insert, update, delete on public.penalite_depart from anon, authenticated;

-- 470b (même jour, appliquée) : date de la notification écrite envoyée par le bureau (PowerHouse n'envoie rien) ;
-- débit réel possible 7 jours après (contrat saisonnier art. 11 : 7 jours pour présenter des observations).
alter table public.penalite_depart add column if not exists notifie_le date;
alter table public.penalite_depart add column if not exists notifie_par_label text;
comment on column public.penalite_depart.notifie_le is 'Date de la notification écrite envoyée au voyageur PAR LE BUREAU (heure constatée + calcul) ; débit réel possible 7 jours après (contrat art. 11). PowerHouse n''envoie rien.';
