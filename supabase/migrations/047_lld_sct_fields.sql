-- Migration 047 : Champs bancaires pour génération virements SCT (SEPA pain.001.001.03)
--
-- Contexte : génération de fichiers XML SEPA Credit Transfer pour :
--   1. Virements aux propriétaires (depuis compte loyers LLD)
--   2. Virement honoraires DCB (du compte loyers vers compte principal)
--
-- Nouveaux champs :
--   proprietaire.bic           — BIC du propriétaire (optionnel, intra-EU SEPA)
--   agency_config.lld_*        — coordonnées bancaires des comptes LLD

-- BIC propriétaire (optionnel depuis 2016 pour virements SEPA intra-UE)
ALTER TABLE proprietaire ADD COLUMN IF NOT EXISTS bic text;

-- Coordonnées bancaires LLD dans agency_config
ALTER TABLE agency_config
  ADD COLUMN IF NOT EXISTS lld_iban_loyers    text,
  ADD COLUMN IF NOT EXISTS lld_bic_loyers     text,
  ADD COLUMN IF NOT EXISTS lld_iban_cautions  text,
  ADD COLUMN IF NOT EXISTS lld_bic_cautions   text,
  ADD COLUMN IF NOT EXISTS lld_iban_principal text,
  ADD COLUMN IF NOT EXISTS lld_bic_principal  text,
  ADD COLUMN IF NOT EXISTS lld_nom_titulaire  text;
