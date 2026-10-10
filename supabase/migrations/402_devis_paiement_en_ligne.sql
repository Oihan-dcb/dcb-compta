-- 402 — Devis payé en ligne → résa manuelle → contrat (11/10/2026, brique commune du futur « module direct »).
--
-- Parcours voulu par Oïhan : 1) le bureau ENVOIE le devis (mail Resend, au clic, aperçu exact) ;
-- 2) le voyageur clique « Réserver et payer » sur la page devis (Stripe, compte de l'agence, carte enregistrée
--    pour le solde off_session) ; 3) paiement réussi (webhook Stripe dcb-contrats → dcb-planning api/devis-paiement)
--    → résa MANUELLE Hospitable créée (api/_resaManuelle.js), option levée, devis « converti » ;
-- 4) la résa déclenche le contrat comme toutes les résas (webhook-hospitable / cron-auto-contracts → generate-contract),
--    qui lit le paiement DÉJÀ reçu (resa_paiement_choix.acompte_paye_le) : acompte payé, solde planifié avec la carte ;
-- 5) dates prises entre-temps → pas de résa, remboursement Stripe automatique + alerte bureau.
-- Code : dcb-planning api/_reservationDirecte.js (brique), api/devis-paiement.js, api/devis-voyageur.js ;
--        dcb-contrats api/stripe-direct.js (passerelle Stripe interne), api/webhook-stripe.js.

-- ═══ 1. devis_option : envoi + paiement en ligne ═══════════════════════════════════════════════════
alter table public.devis_option
  add column if not exists envoye_le                timestamptz,
  add column if not exists envoye_a                 text,
  add column if not exists envois                   integer not null default 0,
  add column if not exists paiement_statut          text,
  add column if not exists paiement_plan            jsonb,
  add column if not exists paiement_montant_centimes integer,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_customer_id       text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists paye_le                  timestamptz,
  add column if not exists conversion_le            timestamptz,
  add column if not exists conversion_erreur        text,
  add column if not exists stripe_refund_id         text,
  add column if not exists rembourse_le             timestamptz;

alter table public.devis_option drop constraint if exists devis_option_paiement_statut_check;
alter table public.devis_option add constraint devis_option_paiement_statut_check check (paiement_statut is null or paiement_statut in (
  'intention',          -- PaymentIntent créé, voyageur sur la page de paiement
  'en_traitement',      -- Stripe « processing » (banque) : l'option n'est PAS libérée par le cron
  'paye',               -- paiement reçu, conversion pas encore faite
  'conversion',         -- conversion en cours (verrou)
  'converti',           -- résa créée
  'echec_conversion',   -- erreur technique (Hospitable…) : réessayée par Stripe / le voyageur, bureau alerté
  'dates_prises',       -- nuits prises entre-temps : pas de résa, remboursement à faire
  'rembourse',          -- remboursement Stripe effectué
  'remboursement_echec' -- remboursement automatique en échec : à faire à la main (bureau alerté)
));
alter table public.devis_option drop constraint if exists devis_option_montant_paiement_check;
alter table public.devis_option add constraint devis_option_montant_paiement_check check (paiement_montant_centimes is null or paiement_montant_centimes > 0) not valid;
create unique index if not exists uq_devis_option_stripe_pi on public.devis_option(stripe_payment_intent_id) where stripe_payment_intent_id is not null;

comment on column public.devis_option.envoye_le is 'Dernier envoi du devis au voyageur par mail (bouton « Envoyer le devis », jamais automatique) (402).';
comment on column public.devis_option.paiement_statut is 'Paiement en ligne du devis (Stripe) : intention → (en_traitement) → paye → conversion → converti ; dates_prises → rembourse / remboursement_echec ; echec_conversion (402).';
comment on column public.devis_option.paiement_plan is 'Plan de paiement en ligne figé à la création du PaymentIntent (mode carte, à payer maintenant, solde, date du solde, annulation, caution) — calculé côté serveur (api/_reservationDirecte.js) (402).';
comment on column public.devis_option.paiement_montant_centimes is 'Montant du PaymentIntent (calculé serveur, jamais par le navigateur) (402).';

-- ═══ 2. resa_paiement_choix : paiement DÉJÀ reçu (lu par generate-contract) ═════════════════════════
alter table public.resa_paiement_choix
  add column if not exists acompte_paye_le          timestamptz,
  add column if not exists stripe_customer_id       text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists agence                   text;
comment on column public.resa_paiement_choix.acompte_paye_le is 'Non NULL = l''acompte (ou la totalité) a DÉJÀ été payé en ligne (devis payé, module direct) : le contrat l''affiche payé, ne le redemande pas, et planifie le solde sur la carte enregistrée (stripe_customer_id + stripe_payment_method_id) (402).';

-- ═══ 3. Journal ═══════════════════════════════════════════════════════════════════════════════════
alter table public.dispo_action_log drop constraint if exists dispo_action_log_action_check;
alter table public.dispo_action_log add constraint dispo_action_log_action_check check (action in (
  'block', 'unblock', 'set_rules', 'create_direct_reservation', 'create_manual_reservation',
  'devis_option', 'devis_prolonger', 'devis_annuler', 'devis_convertir', 'devis_expire',
  'sejour_hors_hospitable', 'sejour_hors_bloquer', 'sejour_hors_annuler', 'sejour_hors_refacturation', 'contrat_brouillon',
  'devis_envoyer', 'devis_paiement', 'devis_paye_converti', 'devis_rembourse'));
