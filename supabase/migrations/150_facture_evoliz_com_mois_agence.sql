-- Fix: facture_evoliz_com_mois_idx manquait la colonne agence
-- En multi-tenant (DCB + Lauian + Bordeaux), l'index (mois) seul
-- empêche de créer une facture COM pour deux agences différentes le même mois.
DROP INDEX IF EXISTS facture_evoliz_com_mois_idx;
CREATE UNIQUE INDEX facture_evoliz_com_mois_idx
  ON public.facture_evoliz (mois, agence)
  WHERE (type_facture = 'com');
