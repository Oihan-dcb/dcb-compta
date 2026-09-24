-- Migration 270 : type de facture 'rectificative' (audit segment Factures, I-153)
-- Facture complémentaire émise dans Evoliz pour rectifier une facture déjà validée (qui ne se
-- modifie plus). Premier usage 24/09/2026 : 11 factures DCB mars→juillet où les frais retenus sur
-- le reversement figuraient en déduction (F-349 à F-359). Type à part : jamais lu par la génération
-- (facturesExistantes), l'export SCT, verify-virements-sortants ni les relances ; suivi par
-- sync-evoliz-statut (qui ne filtre pas le type).
ALTER TABLE public.facture_evoliz DROP CONSTRAINT IF EXISTS facture_evoliz_type_check;
ALTER TABLE public.facture_evoliz ADD CONSTRAINT facture_evoliz_type_check
  CHECK (type_facture = ANY (ARRAY['honoraires','debours','com','lauian_fmen','lld','rectificative']));
