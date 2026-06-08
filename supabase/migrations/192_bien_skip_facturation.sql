-- Biens "internes" (ex: biens personnels du gérant) pour lesquels DCB ne génère aucune facture honoraires/débours.
-- Si des resas directes/manuelles existent, une facture 0€ est créée uniquement pour tracker le reversement.
ALTER TABLE bien ADD COLUMN IF NOT EXISTS skip_facturation boolean NOT NULL DEFAULT false;

-- LAGREOU et ASKIDA : biens persos Oihan, DCB finance tout, 100% reversement proprio
UPDATE bien SET skip_facturation = true
WHERE id IN (
  'b5bdfaeb-5b68-4c79-bad5-b779987abc8f',  -- LAGREOU
  '6769e9ba-bb0b-4dff-89bf-c8585ec7519e'   -- ASKIDA
);
