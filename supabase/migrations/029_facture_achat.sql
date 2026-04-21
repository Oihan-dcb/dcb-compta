-- Migration 029 : table facture_achat + fournisseur_recurrent
-- Remplace le Word doc de Laura — suivi des factures d'achat mensuel par agence

CREATE TABLE IF NOT EXISTS facture_achat (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text        NOT NULL DEFAULT 'dcb',
  mois                  text        NOT NULL,           -- format YYYY-MM
  fournisseur           text        NOT NULL,
  montant_ttc           numeric     NOT NULL,
  montant_ht            numeric,
  type_paiement         text        DEFAULT 'virement', -- virement|cb|prelevement|cheque|especes
  categorie             text,                           -- telecom|abonnement|logiciel|loyer|materiel|autre
  statut                text        DEFAULT 'a_valider',-- a_valider|valide|rejete
  notes                 text,
  pdf_url               text,                           -- Supabase Storage
  pennylane_document_id text,                           -- rempli quand pushé vers Pennylane
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fournisseur_recurrent (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  agence           text    NOT NULL DEFAULT 'dcb',
  nom              text    NOT NULL,
  pattern_libelle  text,   -- substring à chercher dans mouvement_bancaire.libelle
  categorie        text,
  montant_habituel numeric,
  actif            boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

-- Fournisseurs récurrents DCB connus
INSERT INTO fournisseur_recurrent (agence, nom, pattern_libelle, categorie, montant_habituel) VALUES
  ('dcb', 'SFR',        'SFR',        'telecom',    NULL),
  ('dcb', 'Canal+',     'CANAL',      'abonnement', NULL),
  ('dcb', 'Disney+',    'DISNEY',     'abonnement', NULL),
  ('dcb', 'ChatGPT',    'OPENAI',     'logiciel',   NULL),
  ('dcb', 'PriceLabs',  'PRICELABS',  'logiciel',   NULL),
  ('dcb', 'Amazon',     'AMAZON',     'abonnement', NULL),
  ('dcb', 'UberEats',   'UBER EATS',  'autre',      NULL)
ON CONFLICT DO NOTHING;

-- RLS : accès public (même pattern que le reste de l'app)
ALTER TABLE facture_achat ENABLE ROW LEVEL SECURITY;
ALTER TABLE fournisseur_recurrent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all_facture_achat"         ON facture_achat         FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "open_all_fournisseur_recurrent" ON fournisseur_recurrent FOR ALL TO public USING (true) WITH CHECK (true);
