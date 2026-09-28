-- Les index d'unicité de facture_evoliz ignoraient l'agence : DCB ne pouvait pas émettre
-- un débours (ou toute facture) pour un proprio/bien/mois déjà facturé côté Lauïan.
-- Cas réel : PALMARIA 07/2026 — ménage de fond Eve Vincent relevant de DCB, bloqué par le
-- débours Lauïan du même proprio (AIA BIARRITZ). On ajoute agence à la clé (relâchement pur,
-- aucune ligne existante ne peut violer la nouvelle contrainte). Aucun upsert ne s'appuie dessus.
DROP INDEX IF EXISTS public.facture_evoliz_unique_bien;
CREATE UNIQUE INDEX facture_evoliz_unique_bien ON public.facture_evoliz
  USING btree (agence, proprietaire_id, mois, type_facture, bien_id) WHERE (bien_id IS NOT NULL);
DROP INDEX IF EXISTS public.facture_evoliz_unique_groupe;
CREATE UNIQUE INDEX facture_evoliz_unique_groupe ON public.facture_evoliz
  USING btree (agence, proprietaire_id, mois, type_facture) WHERE (bien_id IS NULL);
