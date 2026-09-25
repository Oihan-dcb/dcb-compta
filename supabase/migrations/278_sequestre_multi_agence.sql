-- Migration 278 : séquestre multi-agence — fiche compte, grand livre des mandants, clôture mensuelle
-- (25/09/2026, suite I-161).
--
-- Jusqu'ici le justificatif était codé en dur pour DCB (compte Pennylane, sources bancaires, date de
-- bascule CaisseEpargne → Pennylane, mois de départ). Reconstituer le séquestre a demandé des jours
-- (ancien compte, remises groupées sans détail, libellés hors convention…). Désormais :
--   · sequestre_compte          : UNE fiche par agence (sources et périodes, ouverture, solde) —
--                                 ajouter une agence = remplir cette fiche ;
--   · sequestre_ecriture        : grand livre des mandants (loi Hoguet) — chaque mouvement du
--                                 séquestre attribué à un ayant droit et à un mois, recalculé chaque
--                                 nuit ; ce qui n'est pas attribuable part en « a_affecter » ;
--   · sequestre_cloture_mensuelle : photo figée, par mois, du solde de chaque ayant droit.

CREATE TABLE IF NOT EXISTS public.sequestre_compte (
  agence              text PRIMARY KEY,
  libelle             text NOT NULL,
  iban                text,
  -- Sources bancaires du compte et leur période : [{ "source": "CaisseEpargne", "du": "2025-12-24", "au": "2026-07-03" }, …]
  -- (au null = jusqu'à aujourd'hui). Recoupées avec le relevé de la banque.
  sources             jsonb NOT NULL,
  ouverture_date      date NOT NULL,          -- veille du 1er mouvement suivi
  ouverture_solde     integer NOT NULL DEFAULT 0,   -- centimes
  ouverture_note      text,
  mois_debut          text NOT NULL,          -- 1er mois justifié (YYYY-MM)
  pennylane_account_id text,                  -- solde réel lu chez Pennylane ; sinon ouverture + mouvements
  autres_agences_regex text,                  -- libellés des virements vers/depuis l'autre agence (inter-agence)
  actif               boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sequestre_compte (agence, libelle, iban, sources, ouverture_date, ouverture_solde, ouverture_note, mois_debut, pennylane_account_id, autres_agences_regex) VALUES
 ('dcb', 'Séquestre location saisonnière — Destination Côte Basque', 'FR76 1333 5000 4008 0030 4976 555',
  '[{"source":"CaisseEpargne","du":"2025-12-24","au":"2026-07-03"},{"source":"csv","du":"2025-12-24","au":"2026-07-03"},{"source":"Pennylane_LOCATION_SAISONNIERE","du":"2026-07-04","au":null}]',
  '2025-12-23', 0, 'Compte ouvert à 0 le 24/12/2025 (changement de banque). Solde de l''ancien compte (…727) repris le 28/01/2026 + rapatriements Airbnb ancien RIB des 04/03 et 06/03 : voir sequestre_affectation « reprise_ancien_sequestre ». Relevé complet recoupé ligne à ligne le 25/09/2026.',
  '2026-01', '14431436800', 'lauian'),
 ('lauian', 'Séquestre location saisonnière — Lauïan Immobilier', 'FR76 1333 5000 4008 0029 6014 240',
  '[{"source":"CaisseEpargne","du":"2025-12-03","au":null}]',
  '2025-12-02', 1927107, 'Déduit du solde bancaire du 25/09/2026 (65 857,32 €, relevé vérifié au centime) moins les mouvements importés (doublon Guérin exclu). À confirmer sur le relevé de décembre 2025.',
  '2026-01', NULL, 'destination cote basque|dcb')
ON CONFLICT (agence) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sequestre_ecriture (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agence          text NOT NULL,
  mouvement_id    uuid NOT NULL REFERENCES public.mouvement_bancaire(id) ON DELETE CASCADE,
  ligne           integer NOT NULL DEFAULT 0,   -- une remise groupée = une écriture par bénéficiaire
  date_operation  date NOT NULL,
  montant         integer NOT NULL,             -- centimes, + entrée / − sortie
  ayant_droit     text NOT NULL,                -- proprietaire | dcb | ae | voyageur | autre_agence | banque | reprise | a_affecter
  tiers_id        uuid,                         -- proprietaire.id / auto_entrepreneur.id si connu
  tiers_nom       text,
  mois            text,                         -- mois comptable imputé (YYYY-MM)
  nature          text NOT NULL,                -- ex. encaissement_resa, reversement, remise_groupee, hon, fmen, com, paiement_ae, remboursement_debours…
  regle           text NOT NULL,                -- auto | affectation_manuelle | detail_remise | rapprochement
  detail          jsonb,
  calcule_le      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mouvement_id, ligne)
);
CREATE INDEX IF NOT EXISTS sequestre_ecriture_agence_idx ON public.sequestre_ecriture (agence, ayant_droit, mois);

CREATE TABLE IF NOT EXISTS public.sequestre_cloture_mensuelle (
  agence       text NOT NULL,
  mois         text NOT NULL,
  solde_banque integer NOT NULL,     -- solde réel au dernier jour du mois
  par_ayant_droit jsonb NOT NULL,    -- [{ayant_droit, tiers_id, nom, du, paye, reste}]
  ecart        integer NOT NULL,
  verrouille   boolean NOT NULL DEFAULT false,
  verrouille_par text,
  verrouille_le  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agence, mois)
);

ALTER TABLE public.sequestre_compte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequestre_ecriture ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequestre_cloture_mensuelle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_all_sequestre_compte ON public.sequestre_compte;
CREATE POLICY staff_all_sequestre_compte ON public.sequestre_compte FOR ALL TO authenticated USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
DROP POLICY IF EXISTS staff_all_sequestre_ecriture ON public.sequestre_ecriture;
CREATE POLICY staff_all_sequestre_ecriture ON public.sequestre_ecriture FOR ALL TO authenticated USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
DROP POLICY IF EXISTS staff_all_sequestre_cloture ON public.sequestre_cloture_mensuelle;
CREATE POLICY staff_all_sequestre_cloture ON public.sequestre_cloture_mensuelle FOR ALL TO authenticated USING (public.auth_user_is_staff()) WITH CHECK (public.auth_user_is_staff());
