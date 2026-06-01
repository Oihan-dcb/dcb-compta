-- Migration 159 — owner_profile_config
-- Remplace owner_visibility_config (50 colonnes booléennes) + owner_notif_prefs
-- par une table unifiée avec JSONB pour la visibilité et les préférences notifs.
-- Les anciennes tables sont conservées (pas supprimées) pour rétrocompatibilité.

CREATE TABLE IF NOT EXISTS owner_profile_config (
  proprietaire_id  UUID PRIMARY KEY REFERENCES proprietaire(id) ON DELETE CASCADE,
  agence           TEXT NOT NULL DEFAULT 'dcb',

  -- Profil de visibilité
  profil           TEXT NOT NULL DEFAULT 'suivi',   -- essentiel | suivi | transparent | investisseur | personnalise
  visibilite       JSONB NOT NULL DEFAULT '{}',     -- flags booléens + types_demandes

  -- Canal push/email/off + langue
  push_canal       TEXT NOT NULL DEFAULT 'push',
  notif_resa       BOOLEAN NOT NULL DEFAULT true,
  langue           TEXT NOT NULL DEFAULT 'fr',

  -- Préférences notifications
  notif_profil     TEXT NOT NULL DEFAULT 'essentiel',  -- silencieux | essentiel | complet | personnalise
  notif_flags      JSONB NOT NULL DEFAULT '{}',        -- notif_resa_new, notif_resa_cancel, etc.
  horaires_actifs  BOOLEAN NOT NULL DEFAULT true,
  recap_hebdo      BOOLEAN NOT NULL DEFAULT false,
  recap_mensuel    BOOLEAN NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE owner_profile_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON owner_profile_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_own" ON owner_profile_config
  FOR SELECT TO anon USING (true);

CREATE POLICY "staff_manage_owner_profile" ON owner_profile_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_owner_profile_config_agence ON owner_profile_config(agence);

-- ── Migration des données existantes ────────────────────────────────────────────

INSERT INTO owner_profile_config (
  proprietaire_id, agence, profil, visibilite,
  push_canal, notif_resa, langue,
  notif_profil, notif_flags, horaires_actifs, recap_hebdo, recap_mensuel,
  updated_at
)
SELECT
  ovc.proprietaire_id,
  COALESCE(ovc.agence, 'dcb'),
  -- Renomme standard → suivi
  CASE WHEN COALESCE(ovc.profil, 'suivi') = 'standard' THEN 'suivi' ELSE COALESCE(ovc.profil, 'suivi') END,
  -- Pack tous les booléens dans JSONB
  jsonb_build_object(
    'revenus_bruts',           COALESCE(ovc.revenus_bruts, false),
    'hebergement_net',         COALESCE(ovc.hebergement_net, false),
    'commission_base',         COALESCE(ovc.commission_base, true),
    'commission_detail',       COALESCE(ovc.commission_detail, false),
    'menage',                  COALESCE(ovc.menage, true),
    'prestations',             COALESCE(ovc.prestations, true),
    'frais_divers',            COALESCE(ovc.frais_divers, false),
    'achats_proprio',          COALESCE(ovc.achats_proprio, false),
    'taxe_sejour',             COALESCE(ovc.taxe_sejour, false),
    'rapprochement',           COALESCE(ovc.rapprochement, false),
    'statut_virement',         COALESCE(ovc.statut_virement, true),
    'date_virement',           COALESCE(ovc.date_virement, true),
    'montant_vir_reel',        COALESCE(ovc.montant_vir_reel, false),
    'taux_occupation',         COALESCE(ovc.taux_occupation, true),
    'nuits_vendues',           COALESCE(ovc.nuits_vendues, false),
    'prix_moyen',              COALESCE(ovc.prix_moyen, false),
    'revpar',                  COALESCE(ovc.revpar, false),
    'comparaison_n1',          COALESCE(ovc.comparaison_n1, false),
    'projection_revenus',      COALESCE(ovc.projection_revenus, false),
    'plateforme',              COALESCE(ovc.plateforme, true),
    'voyageur_complet',        COALESCE(ovc.voyageur_complet, true),
    'voyageur_contact',        COALESCE(ovc.voyageur_contact, false),
    'note_voyageur',           COALESCE(ovc.note_voyageur, true),
    'planning_reservations',   COALESCE(ovc.planning_reservations, true),
    'planning_blocages',       COALESCE(ovc.planning_blocages, true),
    'planning_motif_blocage',  COALESCE(ovc.planning_motif_blocage, false),
    'planning_sejours_proprio',COALESCE(ovc.planning_sejours_proprio, true),
    'planning_menage_date',    COALESCE(ovc.planning_menage_date, true),
    'planning_menage_heure',   COALESCE(ovc.planning_menage_heure, false),
    'demande_blocage_dates',   COALESCE(ovc.demande_blocage_dates, true),
    'menage_date',             COALESCE(ovc.menage_date, true),
    'maintenance_actif',       COALESCE(ovc.maintenance_actif, false),
    'maintenance_statut',      COALESCE(ovc.maintenance_statut, false),
    'maintenance_devis',       COALESCE(ovc.maintenance_devis, false),
    'maintenance_validation',  COALESCE(ovc.maintenance_validation, false),
    'maintenance_factures',    COALESCE(ovc.maintenance_factures, false),
    'maintenance_tech_issues', COALESCE(ovc.maintenance_tech_issues, false),
    'maintenance_entretiens',  COALESCE(ovc.maintenance_entretiens, false),
    'documents_mandat',        COALESCE(ovc.documents_mandat, true),
    'documents_factures',      COALESCE(ovc.documents_factures, true),
    'documents_releves',       COALESCE(ovc.documents_releves, true),
    'documents_diagnostics',   COALESCE(ovc.documents_diagnostics, false),
    'documents_contrats',      COALESCE(ovc.documents_contrats, false),
    'documents_attestations',  COALESCE(ovc.documents_attestations, false),
    'documents_inventaire',    COALESCE(ovc.documents_inventaire, false),
    'documents_photos',        COALESCE(ovc.documents_photos, false),
    'demandes_actives',        COALESCE(ovc.demandes_actives, true),
    'messagerie',              COALESCE(ovc.messagerie, true),
    'notifications_email',     COALESCE(ovc.notifications_email, false),
    'types_demandes',          COALESCE(ovc.types_demandes::jsonb, '["blocage_dates","intervention","probleme","question"]'::jsonb)
  ),
  COALESCE(ovc.push_canal, 'push'),
  COALESCE(ovc.notif_resa, true),
  COALESCE(ovc.langue, 'fr'),
  -- Renomme detaille → complet dans notif_profil
  CASE WHEN COALESCE(onp.profile, 'essentiel') = 'detaille' THEN 'complet' ELSE COALESCE(onp.profile, 'essentiel') END,
  jsonb_build_object(
    'notif_resa_new',        COALESCE(onp.notif_resa_new, true),
    'notif_resa_cancel',     COALESCE(onp.notif_resa_cancel, true),
    'notif_demande_reponse', COALESCE(onp.notif_demande_reponse, true),
    'notif_devis',           COALESCE(onp.notif_devis, false),
    'notif_statut',          COALESCE(onp.notif_statut, false),
    'notif_ticket',          COALESCE(onp.notif_ticket, false)
  ),
  COALESCE(onp.horaires_actifs, true),
  COALESCE(onp.recap_hebdo, false),
  COALESCE(onp.recap_mensuel, false),
  now()
FROM owner_visibility_config ovc
LEFT JOIN owner_notif_prefs onp ON onp.proprio_id = ovc.proprietaire_id
ON CONFLICT (proprietaire_id) DO NOTHING;
