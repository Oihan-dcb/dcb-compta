-- Migration 170 — contract_templates
-- Templates HTML Mustache pour la génération automatique de contrats
-- FR / EN / ES × saisonnier / lld × agence

CREATE TABLE IF NOT EXISTS contract_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agence              TEXT NOT NULL,          -- dcb | lauian | bordeaux
  langue              TEXT NOT NULL,          -- fr | en | es
  type_contrat        TEXT NOT NULL,          -- saisonnier | lld
  version             TEXT NOT NULL,          -- "2026-v1"
  nom                 TEXT,
  contenu_html        TEXT NOT NULL,          -- HTML avec {{variables}} Mustache
  variables_attendues JSONB DEFAULT '[]',     -- liste pour validation à la génération
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (agence, langue, type_contrat, version)
);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON contract_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON contract_templates
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_contract_templates_lookup
  ON contract_templates(agence, langue, type_contrat, is_active);
