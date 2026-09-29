-- Mode de traitement « rectif_facture » : requalification d'une ligne facturée à tort sur une facture
-- déjà validée (ex. « Régularisation virement » facturée comme vente avec TVA en août 2026 — F-342/343/
-- 346/347/348, 358,65 € dont 59,77 € de TVA). La facture du mois de facturation porte une ligne NÉGATIVE
-- (HT + TVA) citant la facture d'origine (facture rectificative) ; le reversement n'est PAS modifié :
-- le propriétaire devait bien la somme, seule sa qualification (vente) était fausse.
ALTER TABLE public.frais_proprietaire DROP CONSTRAINT frais_proprietaire_mode_traitement_check;
ALTER TABLE public.frais_proprietaire ADD CONSTRAINT frais_proprietaire_mode_traitement_check
  CHECK (mode_traitement = ANY (ARRAY['deduire_loyer','facturer_direct','remboursement','facturer_et_deduire','rectif_facture']));
