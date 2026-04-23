-- Migration 051 : Enrichissement table proprietaire + table mandat_gestion

-- Nouveaux champs sur proprietaire
ALTER TABLE proprietaire
  ADD COLUMN IF NOT EXISTS type_proprio text DEFAULT 'particulier'
    CHECK (type_proprio IN ('particulier', 'sci', 'societe', 'indivision')),
  ADD COLUMN IF NOT EXISTS notes text;

-- Table mandat de gestion
CREATE TABLE IF NOT EXISTS mandat_gestion (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agence           text        NOT NULL DEFAULT 'dcb' REFERENCES agency_config(agence),
  proprietaire_id  uuid        NOT NULL REFERENCES proprietaire(id) ON DELETE CASCADE,
  numero           text,
  date_signature   date,
  date_echeance    date,
  type             text        DEFAULT 'gestion_locative'
                               CHECK (type IN ('gestion_locative', 'location_simple')),
  taux_commission  numeric,    -- override du taux proprio si renseigné ici
  conditions       text,       -- clauses particulières texte libre
  statut           text        DEFAULT 'actif'
                               CHECK (statut IN ('actif', 'resilie', 'en_renouvellement')),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE mandat_gestion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_mandat_gestion" ON mandat_gestion
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_mandat_proprietaire ON mandat_gestion(proprietaire_id);
CREATE INDEX IF NOT EXISTS idx_mandat_agence       ON mandat_gestion(agence);
