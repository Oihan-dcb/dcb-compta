-- Migration 037 : champ gestion_taxe_sejour sur bien
-- Indique si DCB gère la collecte et le reversement de la taxe de séjour pour ce bien.
-- Seuls les biens avec gestion_taxe_sejour = true apparaissent dans PageTaxeSejour.

ALTER TABLE bien ADD COLUMN IF NOT EXISTS gestion_taxe_sejour boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bien_gestion_taxe ON bien (agence, gestion_taxe_sejour);
