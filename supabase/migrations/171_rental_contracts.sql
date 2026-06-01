-- Migration 171 — rental_contracts
-- Un contrat par réservation.
-- Toutes les données parties/bien/séjour sont figées en snapshot JSONB
-- au moment de la génération — indépendantes de toute modification ultérieure
-- dans Hospitable, Supabase ou ailleurs.

CREATE TABLE IF NOT EXISTS rental_contracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agence           TEXT NOT NULL,
  reservation_id   TEXT,                          -- code Hospitable (ex: HM1234)
  bien_id          UUID REFERENCES bien(id),
  proprietaire_id  UUID REFERENCES proprietaire(id),
  template_id      UUID REFERENCES contract_templates(id),
  template_version TEXT,
  langue           TEXT NOT NULL DEFAULT 'fr',   -- fr | en | es

  -- ── Snapshots immuables ───────────────────────────────────────────────────
  -- Figées au moment de la génération.
  -- Même si Hospitable, le bien ou le proprio changent après, le contrat
  -- signé reste cohérent.

  guest_snapshot   JSONB NOT NULL DEFAULT '{}',
  -- {
  --   "civilite": "Monsieur",
  --   "nom": "Dupont", "prenom": "Jean",
  --   "nom_complet": "Jean Dupont",
  --   "email": "jean@...",
  --   "telephone": "+33612345678",
  --   "adresse": "12 rue de la Paix, 75001 Paris",
  --   "nb_personnes": 4
  -- }

  sejour_snapshot  JSONB NOT NULL DEFAULT '{}',
  -- {
  --   "date_arrivee": "2026-07-15",
  --   "heure_arrivee": "17:00",
  --   "date_depart": "2026-07-22",
  --   "heure_depart": "10:00",
  --   "nb_nuits": 7,
  --   "montant_loyer_cts": 175000,
  --   "acompte_pourcentage": 30,
  --   "acompte_montant_cts": 52500,
  --   "taxe_sejour_cts": 840,
  --   "plateforme": "direct",
  --   "hospitable_property_id": "xxx",
  --   "garantie_cb": true
  -- }

  bien_snapshot    JSONB NOT NULL DEFAULT '{}',
  -- {
  --   "nom": "Villa Belezia",
  --   "nature": "villa",
  --   "adresse": "12 chemin ...",
  --   "capacite_max": 8,
  --   "a_piscine": true,
  --   "proprio_nom": "Martin Sébastien",
  --   "proprio_statut": "Particulier",
  --   "proprio_adresse": "...",
  --   "classement": "4★",
  --   "superficie": 180,
  --   "nb_pieces": 5,
  --   "date_construction": "1990",
  --   "etage": "RDC",
  --   "distance_mer_m": 800,
  --   "distance_plage_m": 600,
  --   "distance_gare_m": 3000,
  --   "distance_centre_m": 1500,
  --   "exposition": "Sud-Ouest",
  --   "voisinage": "Résidentiel calme",
  --   "description_pieces": { "sejour": "...", "cuisine": "...", "sdb": "...", "toilettes": "..." },
  --   "heure_arrivee_defaut": "17:00",
  --   "heure_depart_defaut": "10:00"
  -- }

  -- ── Statut ────────────────────────────────────────────────────────────────
  statut           TEXT NOT NULL DEFAULT 'draft',
  -- draft     → généré, pas encore envoyé
  -- sent      → lien envoyé au voyageur
  -- signed    → signé + carte enregistrée
  -- cancelled → annulé manuellement
  -- expired   → lien expiré sans signature

  -- ── PDF ──────────────────────────────────────────────────────────────────
  pdf_draft_url    TEXT,         -- Supabase Storage : avant signature
  pdf_draft_hash   TEXT,         -- SHA256 du PDF draft
  pdf_signed_url   TEXT,         -- Supabase Storage : après signature (avec canvas)
  pdf_signed_hash  TEXT,         -- SHA256 du PDF signé

  -- ── Timestamps ───────────────────────────────────────────────────────────
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  signed_at        TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ   -- lien de signature expire 72h après envoi
);

ALTER TABLE rental_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON rental_contracts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON rental_contracts
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_rental_contracts_agence
  ON rental_contracts(agence, statut, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rental_contracts_reservation
  ON rental_contracts(reservation_id);

CREATE INDEX IF NOT EXISTS idx_rental_contracts_bien
  ON rental_contracts(bien_id);
