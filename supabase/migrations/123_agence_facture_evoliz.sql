-- Migration 123 : Ajouter colonne agence à facture_evoliz
-- La table n'était pas filtrée par agence → les factures DCB et Lauian se mélangeaient.

ALTER TABLE facture_evoliz ADD COLUMN IF NOT EXISTS agence text NOT NULL DEFAULT 'dcb';

-- Backfill : toutes les factures existantes sont DCB
UPDATE facture_evoliz SET agence = 'dcb' WHERE agence = 'dcb';

CREATE INDEX IF NOT EXISTS idx_facture_evoliz_agence ON facture_evoliz(agence);
