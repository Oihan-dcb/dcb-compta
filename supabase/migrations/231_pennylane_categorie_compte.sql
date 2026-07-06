-- Migration 231 : mapping categorie facture_achat → compte comptable Pennylane
--
-- facture_achat.categorie est une valeur texte libre (telecom|abonnement|logiciel|
-- loyer|materiel|salaire|prestataire_ae|plateforme|fournitures|securite|publicite|autre).
-- Cette table associe chaque categorie à un ledger_account_id Pennylane, par agence
-- (les plans comptables DCB et Lauian ont des numéros de compte différents).

CREATE TABLE IF NOT EXISTS pennylane_categorie_compte (
  agence                        text NOT NULL DEFAULT 'dcb',
  categorie                     text NOT NULL,
  pennylane_ledger_account_id   integer,
  pennylane_ledger_account_num  text,   -- ex: '606100' — pour lisibilité, pas utilisé dans les appels API
  updated_at                    timestamptz DEFAULT now(),
  PRIMARY KEY (agence, categorie)
);

ALTER TABLE pennylane_categorie_compte ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_pennylane_categorie_compte" ON pennylane_categorie_compte
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Comptes confirmés (numéro de compte — l'id exact dépend du taux de TVA de la
-- facture et est résolu à l'exécution via listLedgerAccounts). Les catégories
-- laissées à NULL bloquent le push automatique Pennylane (validation manuelle
-- requise) tant qu'elles ne sont pas tranchées avec Laura/le comptable :
-- logiciel, loyer, materiel, salaire, prestataire_ae, plateforme, securite,
-- carte_bancaire, autre.
-- Liste des catégories = CATEGORIES dans src/pages/PageAchats.jsx (source de vérité).
INSERT INTO pennylane_categorie_compte (agence, categorie, pennylane_ledger_account_num) VALUES
  ('dcb', 'telecom',        '6262'),
  ('dcb', 'abonnement',     '60411'),
  ('dcb', 'publicite',      '62311'),
  ('dcb', 'fournitures',    '6021'),
  ('dcb', 'energie',        '6061'),
  ('dcb', 'assurance',      '616'),
  ('dcb', 'comptabilite',   '62261'),
  ('dcb', 'frais_bancaires','627'),
  ('dcb', 'logiciel',       NULL),
  ('dcb', 'loyer',          NULL),
  ('dcb', 'materiel',       NULL),
  ('dcb', 'salaire',        NULL),
  ('dcb', 'prestataire_ae', NULL),
  ('dcb', 'plateforme',     NULL),
  ('dcb', 'securite',       NULL),
  ('dcb', 'carte_bancaire', NULL),
  ('dcb', 'autre',          NULL)
ON CONFLICT (agence, categorie) DO UPDATE
  SET pennylane_ledger_account_num = EXCLUDED.pennylane_ledger_account_num;
