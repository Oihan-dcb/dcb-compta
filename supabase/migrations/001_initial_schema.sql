-- Migration 001 : Schéma initial DCB Compta
-- Toutes les tables et colonnes créées depuis le début du projet

-- Table bien : biens immobiliers gérés par DCB
ALTER TABLE bien ADD COLUMN IF NOT EXISTS taux_commission_override numeric DEFAULT NULL;
ALTER TABLE bien ADD COLUMN IF NOT EXISTS forfait_menage_proprio integer DEFAULT NULL;
ALTER TABLE bien ADD COLUMN IF NOT EXISTS airbnb_account text DEFAULT NULL;

-- Table facture_ae : factures auto-entrepreneurs
CREATE TABLE IF NOT EXISTS facture_ae (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mois text NOT NULL,
  ae_id uuid,
  bien_id uuid REFERENCES bien(id),
  libelle text NOT NULL,
  montant_ht integer NOT NULL DEFAULT 0,
  montant_ttc integer NOT NULL DEFAULT 0,
  statut text NOT NULL DEFAULT 'brouillon',
  date_facture date,
  numero_facture text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Table facture_evoliz : factures propriétaires vers Evoliz
CREATE TABLE IF NOT EXISTS facture_evoliz (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mois_facturation text NOT NULL,
  proprietaire_id uuid REFERENCES proprietaire(id),
  numero_facture text,
  date_facture date,
  montant_ht integer NOT NULL DEFAULT 0,
  montant_tva integer NOT NULL DEFAULT 0,
  montant_ttc integer NOT NULL DEFAULT 0,
  statut text NOT NULL DEFAULT 'brouillon',
  evoliz_id text,
  evoliz_url text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Table facture_evoliz_ligne : lignes de détail des factures
CREATE TABLE IF NOT EXISTS facture_evoliz_ligne (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id uuid NOT NULL REFERENCES facture_evoliz(id) ON DELETE CASCADE,
  code text NOT NULL,
  libelle text NOT NULL,
  quantite integer DEFAULT 1,
  montant_ht integer NOT NULL DEFAULT 0,
  montant_tva integer NOT NULL DEFAULT 0,
  montant_ttc integer NOT NULL DEFAULT 0,
  reservation_id uuid REFERENCES reservation(id),
  created_at timestamptz DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_facture_ae_mois ON facture_ae(mois);
CREATE INDEX IF NOT EXISTS idx_facture_evoliz_mois ON facture_evoliz(mois_facturation);
CREATE INDEX IF NOT EXISTS idx_facture_evoliz_proprio ON facture_evoliz(proprietaire_id);
CREATE INDEX IF NOT EXISTS idx_facture_evoliz_ligne_facture ON facture_evoliz_ligne(facture_id);
