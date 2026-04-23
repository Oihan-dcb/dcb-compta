-- Migration 048 : renommage des champs bancaires agency_config
-- Nommage clair et distinctif : seq_* pour séquestres, agence_* pour compte opérationnel
--
-- Avant (migration 047, peu lisibles) :
--   lld_iban_loyers, lld_bic_loyers, lld_iban_cautions, lld_bic_cautions
--   lld_iban_principal, lld_bic_principal, lld_nom_titulaire
--
-- Après :
--   seq_lld_loyers_iban, seq_lld_loyers_bic   — séquestre loyers LLD
--   seq_lld_cautions_iban, seq_lld_cautions_bic — séquestre cautions LLD
--   agence_iban, agence_bic, agence_titulaire  — compte opérationnel agence
--   seq_lc_iban, seq_lc_bic                   — séquestre locations courtes (nouveau)

ALTER TABLE agency_config RENAME COLUMN lld_iban_loyers    TO seq_lld_loyers_iban;
ALTER TABLE agency_config RENAME COLUMN lld_bic_loyers     TO seq_lld_loyers_bic;
ALTER TABLE agency_config RENAME COLUMN lld_iban_cautions  TO seq_lld_cautions_iban;
ALTER TABLE agency_config RENAME COLUMN lld_bic_cautions   TO seq_lld_cautions_bic;
ALTER TABLE agency_config RENAME COLUMN lld_iban_principal TO agence_iban;
ALTER TABLE agency_config RENAME COLUMN lld_bic_principal  TO agence_bic;
ALTER TABLE agency_config RENAME COLUMN lld_nom_titulaire  TO agence_titulaire;

-- Séquestre locations courtes (nouveau — pas dans 047)
ALTER TABLE agency_config ADD COLUMN IF NOT EXISTS seq_lc_iban text;
ALTER TABLE agency_config ADD COLUMN IF NOT EXISTS seq_lc_bic  text;
