-- Migration 024 : Locations longues durée (étudiants / mobilité)
--
-- Module "Locations Longues" — remplace le Google Doc de suivi mensuel.
-- Toutes les tables incluent agence (multi-tenant dès la création).
--
-- Tables :
--   etudiant              — locataire longue durée, montants fixes
--   loyer_suivi           — suivi paiement mensuel par étudiant
--   virement_proprio_suivi— suivi virement reversement proprio
--   caution_suivi         — suivi caution (entrée → restitution)
--   etudiant_document     — documents du dossier (contrat, EDS, …)

-- ── etudiant ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS etudiant (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text        NOT NULL DEFAULT 'dcb'
                                    REFERENCES agency_config(agence),

  -- Identité
  nom                   text        NOT NULL,
  prenom                text,
  email                 text,
  telephone             text,

  -- Logement
  bien_id               uuid        REFERENCES bien(id) ON DELETE SET NULL,
  proprietaire_id       uuid        REFERENCES proprietaire(id) ON DELETE SET NULL,
  adresse_complete      text,       -- pour les quittances (ex: "3 rue X, 64200 Biarritz")

  -- Séjour
  date_entree           date        NOT NULL,
  date_sortie_prevue    date,
  date_sortie_reelle    date,

  -- Financier — tout en centimes, tout fixe à la création
  loyer_nu              int         NOT NULL DEFAULT 0,  -- loyer plafonné CC
  supplement_loyer      int         NOT NULL DEFAULT 0,  -- complément fixe
  charges_eau           int         NOT NULL DEFAULT 0,
  charges_copro         int         NOT NULL DEFAULT 0,
  charges_internet      int         NOT NULL DEFAULT 0,
  honoraires_dcb        int         NOT NULL DEFAULT 0,  -- part DCB (fixe mensuel)
  caution               int         NOT NULL DEFAULT 0,
  jour_paiement_attendu int         NOT NULL DEFAULT 5,  -- jour du mois

  -- Statut
  statut                text        NOT NULL DEFAULT 'actif'
                                    CHECK (statut IN ('actif', 'en_attente', 'parti')),

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Montants dérivés (jamais stockés, calculés à l'usage) :
--   montant_total_etudiant  = loyer_nu + supplement_loyer + charges_eau + charges_copro + charges_internet
--   montant_virement_proprio = montant_total_etudiant - honoraires_dcb

CREATE INDEX IF NOT EXISTS idx_etudiant_agence    ON etudiant(agence);
CREATE INDEX IF NOT EXISTS idx_etudiant_bien_id   ON etudiant(bien_id);
CREATE INDEX IF NOT EXISTS idx_etudiant_statut    ON etudiant(statut);

COMMENT ON TABLE  etudiant IS 'Locataires longue durée (étudiants, mobilité) — montants fixes, zéro saisie mensuelle';
COMMENT ON COLUMN etudiant.agence IS 'Agence gestionnaire — filtre multi-tenant';

-- ── loyer_suivi ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyer_suivi (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text        NOT NULL DEFAULT 'dcb'
                                    REFERENCES agency_config(agence),
  etudiant_id           uuid        NOT NULL REFERENCES etudiant(id) ON DELETE CASCADE,
  mois                  text        NOT NULL,  -- YYYY-MM

  statut                text        NOT NULL DEFAULT 'attendu'
                                    CHECK (statut IN ('attendu', 'recu', 'en_retard', 'exonere')),
  date_reception        date,
  montant_recu          int,        -- centimes — alerte si ≠ montant_total_etudiant

  -- Relances automatiques
  nb_relances           int         NOT NULL DEFAULT 0,
  date_derniere_relance timestamptz,

  -- Quittance
  quittance_envoyee_at  timestamptz,
  quittance_pdf_url     text,

  created_at            timestamptz DEFAULT now(),

  UNIQUE (etudiant_id, mois)
);

CREATE INDEX IF NOT EXISTS idx_loyer_suivi_agence      ON loyer_suivi(agence);
CREATE INDEX IF NOT EXISTS idx_loyer_suivi_etudiant_id ON loyer_suivi(etudiant_id);
CREATE INDEX IF NOT EXISTS idx_loyer_suivi_mois        ON loyer_suivi(mois);
CREATE INDEX IF NOT EXISTS idx_loyer_suivi_statut      ON loyer_suivi(statut);

COMMENT ON TABLE  loyer_suivi IS 'Suivi mensuel du paiement loyer par étudiant';
COMMENT ON COLUMN loyer_suivi.agence IS 'Agence — filtre multi-tenant';

-- ── virement_proprio_suivi ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS virement_proprio_suivi (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text        NOT NULL DEFAULT 'dcb'
                                    REFERENCES agency_config(agence),
  etudiant_id           uuid        NOT NULL REFERENCES etudiant(id) ON DELETE CASCADE,
  mois                  text        NOT NULL,  -- YYYY-MM

  statut                text        NOT NULL DEFAULT 'a_virer'
                                    CHECK (statut IN ('a_virer', 'vire')),
  date_virement         date,
  montant               int,        -- centimes — snapshot de montant_virement_proprio au moment du virement

  created_at            timestamptz DEFAULT now(),

  UNIQUE (etudiant_id, mois)
);

CREATE INDEX IF NOT EXISTS idx_virement_proprio_agence      ON virement_proprio_suivi(agence);
CREATE INDEX IF NOT EXISTS idx_virement_proprio_etudiant_id ON virement_proprio_suivi(etudiant_id);
CREATE INDEX IF NOT EXISTS idx_virement_proprio_mois        ON virement_proprio_suivi(mois);

COMMENT ON TABLE  virement_proprio_suivi IS 'Suivi mensuel du virement reversement propriétaire (locations longues)';
COMMENT ON COLUMN virement_proprio_suivi.agence IS 'Agence — filtre multi-tenant';

-- ── caution_suivi ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caution_suivi (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text        NOT NULL DEFAULT 'dcb'
                                    REFERENCES agency_config(agence),
  etudiant_id           uuid        NOT NULL UNIQUE REFERENCES etudiant(id) ON DELETE CASCADE,

  statut                text        NOT NULL DEFAULT 'en_cours'
                                    CHECK (statut IN ('en_cours', 'a_rendre', 'rendue', 'retenue_partielle')),
  date_rendu            date,
  montant_rendu         int,        -- centimes — peut être < caution si retenue
  motif_retenue         text,

  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caution_suivi_agence      ON caution_suivi(agence);
CREATE INDEX IF NOT EXISTS idx_caution_suivi_etudiant_id ON caution_suivi(etudiant_id);

COMMENT ON TABLE  caution_suivi IS 'Suivi caution dépôt de garantie par étudiant (entrée → restitution)';
COMMENT ON COLUMN caution_suivi.agence IS 'Agence — filtre multi-tenant';

-- ── etudiant_document ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS etudiant_document (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence                text        NOT NULL DEFAULT 'dcb'
                                    REFERENCES agency_config(agence),
  etudiant_id           uuid        NOT NULL REFERENCES etudiant(id) ON DELETE CASCADE,

  type                  text        NOT NULL
                                    CHECK (type IN ('contrat_location', 'eds_entree', 'eds_sortie', 'autre')),
  file_url              text,       -- Supabase Storage URL
  date_upload           timestamptz DEFAULT now(),
  notes                 text,

  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_etudiant_document_agence      ON etudiant_document(agence);
CREATE INDEX IF NOT EXISTS idx_etudiant_document_etudiant_id ON etudiant_document(etudiant_id);

COMMENT ON TABLE  etudiant_document IS 'Documents dossier étudiant — contrat GALLIAN, EDS entrée/sortie, etc.';
COMMENT ON COLUMN etudiant_document.agence IS 'Agence — filtre multi-tenant';

-- ── RLS — lecture et écriture authenticated ───────────────────────────────────
ALTER TABLE etudiant             ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyer_suivi          ENABLE ROW LEVEL SECURITY;
ALTER TABLE virement_proprio_suivi ENABLE ROW LEVEL SECURITY;
ALTER TABLE caution_suivi        ENABLE ROW LEVEL SECURITY;
ALTER TABLE etudiant_document    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_etudiant" ON etudiant
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_loyer_suivi" ON loyer_suivi
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_virement_proprio_suivi" ON virement_proprio_suivi
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_caution_suivi" ON caution_suivi
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_etudiant_document" ON etudiant_document
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
