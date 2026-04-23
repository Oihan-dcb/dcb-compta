-- Table dédiée aux relevés bancaires LLD (Caisse d'Épargne)
-- Isolée de mouvement_bancaire (qui sert aux locations courtes)
-- Deux comptes : 'loyers' et 'cautions'

CREATE TABLE IF NOT EXISTS lld_mouvement_bancaire (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence           text        NOT NULL,
  compte           text        NOT NULL CHECK (compte IN ('loyers', 'cautions')),
  date_operation   date        NOT NULL,
  libelle          text,
  detail           text,
  debit            integer,    -- centimes, null si crédit
  credit           integer,    -- centimes, null si débit
  numero_operation text,
  mois_releve      text,       -- YYYY-MM
  statut           text        NOT NULL DEFAULT 'non_rapproche'
                               CHECK (statut IN ('non_rapproche', 'rapproche', 'ignore')),
  etudiant_id      uuid        REFERENCES etudiant(id) ON DELETE SET NULL,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (numero_operation, compte, agence)
);

CREATE INDEX IF NOT EXISTS idx_lld_mb_agence_compte ON lld_mouvement_bancaire(agence, compte);
CREATE INDEX IF NOT EXISTS idx_lld_mb_mois         ON lld_mouvement_bancaire(mois_releve);
CREATE INDEX IF NOT EXISTS idx_lld_mb_etudiant     ON lld_mouvement_bancaire(etudiant_id);
