-- 228 — Marqueur FMEN facturé (appliquée en base le 2026-07-05)
-- FMEN facturé au client Lauian (TTC centimes) par résa. NULL = jamais facturé
-- (résa reportée faute de réel/provision, ou antérieure au mécanisme).
-- Base du rattrapage/ajustement M+1 : ligne facture = (montant_reel ?? montant_ttc) − fmen_facture.
alter table ventilation add column if not exists fmen_facture integer;
comment on column ventilation.fmen_facture is 'FMEN TTC porté sur la facture FMEN Lauian (centimes). NULL = pas encore facturé. Ajustement M+1 = (montant_reel ?? montant_ttc) − fmen_facture.';

-- Backfill exécuté le 2026-07-05 :
-- 1. factures lauian_fmen ENVOYÉES (mai/juin) → fmen_facture = montant_ttc (le prévu facturé)
-- 2. ARROSA (cas particulier, décision Oïhan) + BITXI juin (régularisé par avoir manuel)
--    → fmen_facture = coalesce(montant_reel, montant_ttc) pour neutraliser l'ajustement auto
