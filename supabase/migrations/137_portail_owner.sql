-- Migration 137 : Portail Owner
-- Tables nécessaires au portail propriétaires externe :
--   1. Lien auth_user_id sur proprietaire
--   2. owner_visibility_config — profil de visibilité par proprio (configurable depuis dcb-compta)
--   3. owner_requests — tickets demandes propriétaires (blocages, interventions, questions…)
--   4. owner_documents — documents mis à disposition du proprio (mandat, factures, relevés…)
-- RLS : proprios ne lisent que leurs propres données.

-- ─── 1. Lien auth_user_id sur proprietaire ────────────────────────────────
ALTER TABLE proprietaire
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proprietaire_auth_user_id ON proprietaire(auth_user_id);

-- ─── 2. owner_visibility_config ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_visibility_config (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proprietaire_id      uuid NOT NULL REFERENCES proprietaire(id) ON DELETE CASCADE,
  agence               text NOT NULL DEFAULT 'dcb',

  -- Profil prédéfini (surcharges individuelles ci-dessous)
  profil               text NOT NULL DEFAULT 'standard'
                       CHECK (profil IN ('essentiel','standard','transparent','investisseur','personnalise')),

  -- ── Financier — Revenus ──────────────────────────────────────────────
  revenus_bruts        boolean NOT NULL DEFAULT false,
  prix_nuit_detail     boolean NOT NULL DEFAULT false,
  frais_nettoyage_voyageur boolean NOT NULL DEFAULT false,
  taxe_sejour          boolean NOT NULL DEFAULT false,

  -- Commission DCB
  commission_base      boolean NOT NULL DEFAULT true,
  commission_taux      boolean NOT NULL DEFAULT false, -- afficher le % seul
  commission_montant   boolean NOT NULL DEFAULT true,  -- afficher le montant
  commission_detail    boolean NOT NULL DEFAULT false, -- détail base/extras

  -- Déductions
  menage               boolean NOT NULL DEFAULT true,
  prestations          boolean NOT NULL DEFAULT true,
  frais_maintenance    boolean NOT NULL DEFAULT false,
  frais_divers         boolean NOT NULL DEFAULT false,

  -- ── Financier — Virements & Rapprochement ───────────────────────────
  statut_virement      boolean NOT NULL DEFAULT true,
  date_virement        boolean NOT NULL DEFAULT true,
  rapprochement        boolean NOT NULL DEFAULT false,  -- VIRPayinProuvé
  montant_vir_reel     boolean NOT NULL DEFAULT false,  -- VIRProprioRéel
  historique_virements text    NOT NULL DEFAULT '3m'
                       CHECK (historique_virements IN ('3m','12m','tout','masque')),

  -- ── Réservations ────────────────────────────────────────────────────
  voyageur_complet     boolean NOT NULL DEFAULT false,  -- false = prénom seul
  voyageur_contact     boolean NOT NULL DEFAULT false,  -- email/tel
  plateforme           boolean NOT NULL DEFAULT true,
  prix_par_nuit        boolean NOT NULL DEFAULT false,
  historique_resas     text    NOT NULL DEFAULT '3m'
                       CHECK (historique_resas IN ('1m','3m','12m','tout')),

  -- ── Avis voyageurs ──────────────────────────────────────────────────
  note_voyageur        boolean NOT NULL DEFAULT false,
  texte_avis           boolean NOT NULL DEFAULT false,
  reponse_dcb_avis     boolean NOT NULL DEFAULT false,

  -- ── Planning ────────────────────────────────────────────────────────
  planning_reservations  boolean NOT NULL DEFAULT true,
  planning_blocages      boolean NOT NULL DEFAULT true,
  planning_motif_blocage boolean NOT NULL DEFAULT false,
  planning_sejours_proprio boolean NOT NULL DEFAULT true,
  planning_menage_date   boolean NOT NULL DEFAULT true,
  planning_menage_heure  boolean NOT NULL DEFAULT false,
  planning_arrivees_departs boolean NOT NULL DEFAULT true,
  demande_blocage_dates  boolean NOT NULL DEFAULT true,

  -- ── Ménages & Qualité ───────────────────────────────────────────────
  menage_date            boolean NOT NULL DEFAULT true,
  menage_statut          boolean NOT NULL DEFAULT true,
  prestations_extras_liste boolean NOT NULL DEFAULT false,
  prestations_montant    boolean NOT NULL DEFAULT false,
  menage_photos          boolean NOT NULL DEFAULT false,
  menage_remarques       boolean NOT NULL DEFAULT false,
  menage_incidents       boolean NOT NULL DEFAULT false,

  -- ── Maintenance & Travaux ───────────────────────────────────────────
  maintenance_actif      boolean NOT NULL DEFAULT false,
  maintenance_devis      boolean NOT NULL DEFAULT false,
  maintenance_validation boolean NOT NULL DEFAULT false, -- proprio peut valider devis
  maintenance_statut     boolean NOT NULL DEFAULT false,
  maintenance_factures   boolean NOT NULL DEFAULT false,
  maintenance_impact_reversement boolean NOT NULL DEFAULT false,
  maintenance_historique boolean NOT NULL DEFAULT false,

  -- ── Performance & Statistiques ──────────────────────────────────────
  taux_occupation        boolean NOT NULL DEFAULT true,
  nuits_vendues          boolean NOT NULL DEFAULT true,
  prix_moyen             boolean NOT NULL DEFAULT false,
  revpar                 boolean NOT NULL DEFAULT false,
  comparaison_n1         boolean NOT NULL DEFAULT false,
  benchmark_marche       boolean NOT NULL DEFAULT false,
  recommandations_dcb    boolean NOT NULL DEFAULT false,
  projection_revenus     boolean NOT NULL DEFAULT false,

  -- ── Documents ───────────────────────────────────────────────────────
  documents_mandat       boolean NOT NULL DEFAULT true,
  documents_factures     boolean NOT NULL DEFAULT true,
  documents_releves      boolean NOT NULL DEFAULT true,
  documents_diagnostics  boolean NOT NULL DEFAULT true,
  documents_contrats     boolean NOT NULL DEFAULT false,
  documents_attestations boolean NOT NULL DEFAULT false,
  documents_inventaire   boolean NOT NULL DEFAULT false,
  documents_photos       boolean NOT NULL DEFAULT false,
  releve_version         text    NOT NULL DEFAULT 'simplifie'
                         CHECK (releve_version IN ('complet','simplifie','masque')),

  -- ── Communication & Demandes ────────────────────────────────────────
  demandes_actives       boolean NOT NULL DEFAULT true,
  -- types autorisés : JSON array ['blocage_dates','intervention','probleme','estimation','document','question']
  types_demandes         jsonb   NOT NULL DEFAULT '["blocage_dates","intervention","probleme","question"]'::jsonb,
  messagerie             boolean NOT NULL DEFAULT false,
  notifications_email    boolean NOT NULL DEFAULT true,
  notifications_sms      boolean NOT NULL DEFAULT false,
  frequence_releve       text    NOT NULL DEFAULT 'mensuel'
                         CHECK (frequence_releve IN ('mensuel','trimestriel','manuel')),

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (proprietaire_id)
);

CREATE INDEX IF NOT EXISTS idx_ovc_proprietaire_id ON owner_visibility_config(proprietaire_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_ovc_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ovc_updated_at ON owner_visibility_config;
CREATE TRIGGER trg_ovc_updated_at
  BEFORE UPDATE ON owner_visibility_config
  FOR EACH ROW EXECUTE FUNCTION set_ovc_updated_at();

-- ─── 3. owner_requests (tickets demandes propriétaires) ───────────────────
CREATE TABLE IF NOT EXISTS owner_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proprietaire_id  uuid NOT NULL REFERENCES proprietaire(id) ON DELETE CASCADE,
  bien_id          uuid REFERENCES bien(id) ON DELETE SET NULL,
  agence           text NOT NULL DEFAULT 'dcb',

  type             text NOT NULL
                   CHECK (type IN ('blocage_dates','intervention','probleme','estimation','document','question','autre')),
  statut           text NOT NULL DEFAULT 'recu'
                   CHECK (statut IN ('recu','en_cours','traite','ferme')),

  message          text NOT NULL,
  reponse_dcb      text,
  repondu_le       timestamptz,
  repondu_par      uuid REFERENCES auth.users(id),

  -- Pour les demandes de blocage
  date_debut       date,
  date_fin         date,

  -- Pour les demandes de maintenance
  devis_montant    integer,  -- centimes
  devis_accepte    boolean,
  devis_accepte_le timestamptz,

  priorite         text NOT NULL DEFAULT 'normale'
                   CHECK (priorite IN ('basse','normale','haute','urgente')),

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_or_proprietaire_id ON owner_requests(proprietaire_id);
CREATE INDEX IF NOT EXISTS idx_or_bien_id ON owner_requests(bien_id);
CREATE INDEX IF NOT EXISTS idx_or_statut ON owner_requests(statut);
CREATE INDEX IF NOT EXISTS idx_or_created_at ON owner_requests(created_at DESC);

DROP TRIGGER IF EXISTS trg_or_updated_at ON owner_requests;
CREATE TRIGGER trg_or_updated_at
  BEFORE UPDATE ON owner_requests
  FOR EACH ROW EXECUTE FUNCTION set_ovc_updated_at();

-- ─── 4. owner_documents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proprietaire_id  uuid NOT NULL REFERENCES proprietaire(id) ON DELETE CASCADE,
  bien_id          uuid REFERENCES bien(id) ON DELETE SET NULL,
  agence           text NOT NULL DEFAULT 'dcb',

  nom              text NOT NULL,
  categorie        text NOT NULL DEFAULT 'autre'
                   CHECK (categorie IN ('mandat','facture','releve','diagnostic','contrat','attestation','inventaire','photo','autre')),

  storage_path     text NOT NULL,  -- path dans Supabase Storage bucket 'owner-documents'
  taille_octets    integer,
  mime_type        text,

  date_document    date,     -- date du document (≠ date upload)
  mois_comptable   text,     -- YYYY-MM si releve mensuel
  description      text,

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_od_proprietaire_id ON owner_documents(proprietaire_id);
CREATE INDEX IF NOT EXISTS idx_od_bien_id ON owner_documents(bien_id);
CREATE INDEX IF NOT EXISTS idx_od_categorie ON owner_documents(categorie);
CREATE INDEX IF NOT EXISTS idx_od_date_document ON owner_documents(date_document DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────

-- owner_visibility_config : lecture seule par le proprio concerné
ALTER TABLE owner_visibility_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proprio_read_own_visibility" ON owner_visibility_config;
CREATE POLICY "proprio_read_own_visibility" ON owner_visibility_config
  FOR SELECT USING (
    proprietaire_id IN (
      SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
    )
  );

-- Seul service role peut écrire (dcb-compta backend)

-- owner_requests : proprio lit/crée ses propres demandes, pas les autres
ALTER TABLE owner_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proprio_read_own_requests" ON owner_requests;
CREATE POLICY "proprio_read_own_requests" ON owner_requests
  FOR SELECT USING (
    proprietaire_id IN (
      SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "proprio_insert_own_requests" ON owner_requests;
CREATE POLICY "proprio_insert_own_requests" ON owner_requests
  FOR INSERT WITH CHECK (
    proprietaire_id IN (
      SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
    )
  );

-- Proprio ne peut pas modifier ni supprimer ses demandes (service role only)

-- owner_documents : proprio lit ses documents
ALTER TABLE owner_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proprio_read_own_documents" ON owner_documents;
CREATE POLICY "proprio_read_own_documents" ON owner_documents
  FOR SELECT USING (
    proprietaire_id IN (
      SELECT id FROM proprietaire WHERE auth_user_id = auth.uid()
    )
  );

-- ─── Vue utilitaire pour dcb-compta ──────────────────────────────────────
-- Résumé par proprio : config visibilité + nb demandes en cours
CREATE OR REPLACE VIEW v_owner_portal_status AS
SELECT
  p.id AS proprietaire_id,
  p.nom,
  p.prenom,
  p.email,
  p.agence,
  p.auth_user_id IS NOT NULL AS portail_active,
  ovc.profil,
  ovc.demandes_actives,
  (
    SELECT count(*) FROM owner_requests r
    WHERE r.proprietaire_id = p.id AND r.statut IN ('recu','en_cours')
  ) AS demandes_en_cours
FROM proprietaire p
LEFT JOIN owner_visibility_config ovc ON ovc.proprietaire_id = p.id
WHERE p.actif = true;
