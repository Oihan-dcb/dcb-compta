-- Migration 022 : Table agency_config — configuration par agence
--
-- Contexte multi-tenant : DCB, Lauian Immo, Destination Bordeaux partagent
-- une seule base Supabase filtrée par agence. Chaque agence a ses propres
-- clés API (Evoliz, Pennylane, Resend) et ses métadonnées de marque.
--
-- Règle : Hospitable est COMMUN (pas de config Hospitable par agence).
-- Tout le reste est isolé par agence.

CREATE TABLE IF NOT EXISTS agency_config (
  agence              text        PRIMARY KEY,
  label               text        NOT NULL,
  evoliz_api_key      text,
  evoliz_base_url     text        DEFAULT 'https://www.evoliz.com/api/v1',
  pennylane_api_key   text,
  resend_from_email   text,
  brand_color         text        DEFAULT '#CC9933',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Valeurs initiales pour les trois agences cibles
INSERT INTO agency_config (agence, label, resend_from_email)
VALUES
  ('dcb',      'Destination Côte Basque', 'contact@destinationcotebasque.com'),
  ('lauian',   'Lauian Immo',             'contact@lauianimmo.com'),
  ('bordeaux', 'Destination Bordeaux',    'contact@destinationbordeaux.fr')
ON CONFLICT (agence) DO NOTHING;

-- RLS : lecture anon, écriture service_role uniquement
ALTER TABLE agency_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_can_select_agency_config" ON agency_config
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_can_select_agency_config" ON agency_config
  FOR SELECT TO authenticated USING (true);

-- Note : les clés API sont lues par les Edge Functions (service_role bypass RLS).
-- Ne jamais exposer les clés API côté frontend.
