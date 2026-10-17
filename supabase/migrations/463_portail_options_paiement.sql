-- 463 — PORTAIL VOYAGEUR : PAIEMENT EN LIGNE DES OPTIONS (17/10/2026, demande d'Oïhan).
-- PowerHouse : api/_portailOptions.js (logique), api/sejour.js (page voyageur), api/portail-options-paiement.js (webhook
-- interne), api/portail-voyageur.js (bureau : rembourser une option) ; passerelle Stripe dcb-contrats api/stripe-direct.js
-- (origine « portail_option », compte Stripe de l'AGENCE du bien) ; webhook dcb-contrats api/webhook-stripe.js.
--
-- Interrupteur PORTAIL_OPTIONS_PAIEMENT (Vercel PowerHouse) : absent = rien ne change (demande au bureau) ; « essai » =
-- paiement SIMULÉ visible seulement dans l'aperçu équipe (+ réservations listées dans PORTAIL_OPTIONS_PAIEMENT_RESAS en
-- réel) ; « actif » = paiement réel pour les réservations directes / manuelles (Airbnb / Booking : PORTAIL_OPTIONS_PAIEMENT_OTA).
--
-- 1. portail_voyageur_commande : cycle du paiement (paiement_attente → payee → remboursee…), reçu Stripe, effets créés
--    (équipements, missions, sacs, horaires — pour les défaire au remboursement), remboursements par ligne.
-- 2. reservation.options_portail : options PAYÉES (non remboursées) recopiées par trigger → la ventilation (ventilationCore)
--    en fait une ligne PVOY « Prestation voyageur » (TVA 20 %), HORS revenu Hospitable, sans toucher LOY / VIRProprio.
--    Le trigger remet ventilation_calculee à false : recalcul par la ventilation de nuit (mois non clôturé).
-- 3. reservation_horaire : arrivée anticipée / départ tardif PAYÉS → heure du séjour dans PowerHouse (jamais Hospitable).
-- 4. direct_service.horaire / horaire_heure : service qui décale l'arrivée / le départ (contrôle du créneau : personne ne
--    part le jour de l'arrivée anticipée / n'arrive le jour du départ tardif).

-- ── 1. Commandes du portail ─────────────────────────────────────────────────────────────────────────────────────
alter table public.portail_voyageur_commande drop constraint if exists portail_voyageur_commande_statut_check;
alter table public.portail_voyageur_commande add constraint portail_voyageur_commande_statut_check check (statut in (
  'essai_simulee', 'attente_bureau', 'payee', 'appliquee', 'echec', 'annulee',
  -- 463 : paiement en ligne
  'paiement_attente',     -- PaymentIntent créé, le voyageur est sur l'écran carte (stock tenu 30 min)
  'effet_en_cours',       -- paiement confirmé, effets en cours de création (verrou)
  'a_verifier',           -- payé mais un effet n'a pas pu être créé : alerte, à finir à la main
  'remboursee',           -- toutes les lignes remboursées (bureau, annulation du séjour, ou automatique)
  'remboursee_partiel',   -- une partie des lignes remboursées
  'echec_paiement'        -- paiement refusé / abandonné (aucun effet)
));
alter table public.portail_voyageur_commande
  add column if not exists paiement_mode text check (paiement_mode in ('stripe', 'simule')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_livemode boolean,
  add column if not exists montant_paye_centimes integer,
  add column if not exists recu_url text,
  add column if not exists carte jsonb,
  add column if not exists effets jsonb,
  add column if not exists verrou_le timestamptz,
  add column if not exists erreur text,
  add column if not exists rembourse_centimes integer not null default 0,
  add column if not exists rembourse_le timestamptz,
  add column if not exists remboursements jsonb not null default '[]'::jsonb,
  add column if not exists conditions text,
  add column if not exists langue text,
  add column if not exists tenu_jusqu timestamptz,
  add column if not exists arrivee date,          -- dates du séjour (stock des équipements tenu pendant le paiement)
  add column if not exists depart date,
  add column if not exists maj_le timestamptz;
create unique index if not exists portail_voyageur_commande_pi_uniq on public.portail_voyageur_commande (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists portail_voyageur_commande_attente_idx on public.portail_voyageur_commande (statut, tenu_jusqu) where statut = 'paiement_attente';
comment on column public.portail_voyageur_commande.lignes is 'Lignes « Option voyageur : … » (service_cle, quantite, montant_centimes, libelle_lg). 463 : rembourse_le / rembourse_centimes / refund_id par ligne remboursée.';
comment on column public.portail_voyageur_commande.effets is '463 : ce qui a été créé après paiement (equipment_bookings, mission_menage, besoin_sac, reservation_horaire, note) — défait au remboursement.';

-- ── 2. Options payées → réservation (ventilation PVOY) ───────────────────────────────────────────────────────────
alter table public.reservation add column if not exists options_portail jsonb;
comment on column public.reservation.options_portail is '463 : options payées en ligne dans le portail voyageur (Stripe de l''agence, hors Hospitable), non remboursées : [{libelle, montant (centimes TTC), commande_id}]. Lu par ventilationCore → PVOY. Tenu à jour par trigger depuis portail_voyageur_commande.';

create or replace function public.portail_commande_vers_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_resa uuid := coalesce(new.reservation_id, old.reservation_id);
  v_opts jsonb;
begin
  if v_resa is null then return null; end if;
  select jsonb_agg(jsonb_build_object('libelle', coalesce(l->>'libelle', 'Option voyageur'), 'montant', (l->>'montant_centimes')::int, 'commande_id', c.id) order by c.cree_le, l->>'libelle')
    into v_opts
    from public.portail_voyageur_commande c, jsonb_array_elements(c.lignes) l
   where c.reservation_id = v_resa and c.essai = false and c.paiement_mode = 'stripe'
     and c.statut in ('payee', 'a_verifier', 'remboursee_partiel', 'effet_en_cours')
     and coalesce((l->>'montant_centimes')::int, 0) > 0 and (l->>'rembourse_le') is null;
  update public.reservation set options_portail = v_opts, ventilation_calculee = false
   where id = v_resa and options_portail is distinct from v_opts;
  return null;
end $$;
drop trigger if exists trg_portail_commande_vers_reservation on public.portail_voyageur_commande;
create trigger trg_portail_commande_vers_reservation after insert or update of statut, lignes, essai, paiement_mode or delete
  on public.portail_voyageur_commande for each row execute function public.portail_commande_vers_reservation();

-- ── 3. Heures d'arrivée / de départ décidées dans PowerHouse (option payée) ───────────────────────────────────────
create table if not exists public.reservation_horaire (
  id uuid primary key default gen_random_uuid(),
  resa_hospitable_id text not null,
  reservation_id uuid references public.reservation(id) on delete cascade,
  bien_id uuid references public.bien(id) on delete set null,
  sens text not null check (sens in ('arrivee', 'depart')),
  heure text not null check (heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  source text not null default 'portail' check (source in ('portail', 'devis', 'bureau')),
  commande_id uuid,
  note text,
  cree_le timestamptz not null default now(),
  cree_par text,
  annule_le timestamptz,
  annule_par text
);
create unique index if not exists reservation_horaire_actif_uniq on public.reservation_horaire (resa_hospitable_id, sens) where annule_le is null;
alter table public.reservation_horaire enable row level security;
comment on table public.reservation_horaire is '463 : arrivée anticipée / départ tardif vendus (portail voyageur ou réservation en ligne) — heure du séjour dans PowerHouse, JAMAIS écrite dans Hospitable. Annulée (annule_le) au remboursement.';

-- ── 4. Services qui décalent l'arrivée / le départ ─────────────────────────────────────────────────────────────────
alter table public.direct_service
  add column if not exists horaire text check (horaire in ('arrivee_anticipee', 'depart_tardif')),
  add column if not exists horaire_heure text check (horaire_heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
comment on column public.direct_service.horaire is '463 : arrivée anticipée / départ tardif. Type « demande » = sans prix (au bureau) ; type « service » avec prix = payable, créneau contrôlé (calendrier_creneau_conflits), heure posée dans reservation_horaire.';
update public.direct_service set horaire = 'arrivee_anticipee' where cle = 'arrivee_anticipee' and horaire is null;
update public.direct_service set horaire = 'depart_tardif' where cle = 'depart_tardif' and horaire is null;
