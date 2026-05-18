-- Migration 152 : Ajouter 'lauian_fmen' aux types de facture autorisés
-- DCB génère des factures FMEN séparées pour les propriétaires Lauian (type='lauian_fmen')
-- L'ancienne contrainte ne l'incluait pas → INSERT bloqué

ALTER TABLE facture_evoliz
  DROP CONSTRAINT facture_evoliz_type_check;

ALTER TABLE facture_evoliz
  ADD CONSTRAINT facture_evoliz_type_check
  CHECK (type_facture = ANY (ARRAY['honoraires'::text, 'debours'::text, 'com'::text, 'lauian_fmen'::text]));
