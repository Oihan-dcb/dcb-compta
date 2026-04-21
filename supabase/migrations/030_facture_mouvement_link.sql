-- Migration 030 : lien facture_achat → mouvement_bancaire
-- Permet d'associer une facture d'achat à son prélèvement/virement bancaire

ALTER TABLE facture_achat ADD COLUMN IF NOT EXISTS mouvement_bancaire_id uuid REFERENCES mouvement_bancaire(id) ON DELETE SET NULL;
ALTER TABLE facture_achat ADD COLUMN IF NOT EXISTS date_facture date;
ALTER TABLE facture_achat ADD COLUMN IF NOT EXISTS numero_facture text;
