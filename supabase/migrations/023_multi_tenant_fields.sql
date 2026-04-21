-- Migration 023 : Colonnes agence sur les tables non encore filtrées
--
-- Objectif : systématiser le filtre agence sur toutes les tables qui ne
-- transitent pas déjà par bien.agence. Les tables liées à bien héritent
-- du filtre via JOIN — seules les tables "indépendantes" ont besoin de la
-- colonne directement.
--
-- Tables concernées :
--   - proprietaire     : isolé par agence (Evoliz séparé)
--   - mouvement_bancaire : comptes CE séparés par agence
--   - auto_entrepreneur  : AEs rattachés à une agence
--
-- Tables NON modifiées (filtrent via bien.agence) :
--   - reservation, ventilation, facture_evoliz, mission_menage, etc.
--   - reservation_review, sms_logs, sms_queue (via bien ou reservation)
--
-- Valeur par défaut 'dcb' : rétrocompatibilité avec les données existantes.
-- En prod, un backfill manuel devra qualifier les données Lauian.

-- ── proprietaire ──────────────────────────────────────────────────────────────
ALTER TABLE proprietaire
  ADD COLUMN IF NOT EXISTS agence text NOT NULL DEFAULT 'dcb'
    REFERENCES agency_config(agence);

CREATE INDEX IF NOT EXISTS idx_proprietaire_agence ON proprietaire(agence);

-- ── mouvement_bancaire ────────────────────────────────────────────────────────
ALTER TABLE mouvement_bancaire
  ADD COLUMN IF NOT EXISTS agence text NOT NULL DEFAULT 'dcb'
    REFERENCES agency_config(agence);

CREATE INDEX IF NOT EXISTS idx_mouvement_bancaire_agence ON mouvement_bancaire(agence);

-- ── auto_entrepreneur ─────────────────────────────────────────────────────────
ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS agence text NOT NULL DEFAULT 'dcb'
    REFERENCES agency_config(agence);

CREATE INDEX IF NOT EXISTS idx_auto_entrepreneur_agence ON auto_entrepreneur(agence);

-- ── Commentaires ──────────────────────────────────────────────────────────────
COMMENT ON COLUMN proprietaire.agence      IS 'Agence propriétaire de ce proprio — filtre multi-tenant';
COMMENT ON COLUMN mouvement_bancaire.agence IS 'Agence dont provient ce mouvement bancaire — comptes CE séparés par agence';
COMMENT ON COLUMN auto_entrepreneur.agence  IS 'Agence de rattachement de cet AE — lauian peut avoir ses propres AEs';
