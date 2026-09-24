-- Migration 271 : rattachement d'une facture rectificative à la facture/demande qu'elle justifie (I-154)
-- Cas d'usage (24/09/2026) : frais de gestion / VIP / achats réclamés à tort en débours TVA 0 %
-- juillet-août → facturés à 20 % pour le même TTC (F-360 à F-368), rattachés à leur demande de
-- débours ; sync-evoliz-statut enregistre le paiement Evoliz quand la demande liée est réglée.
ALTER TABLE public.facture_evoliz ADD COLUMN IF NOT EXISTS facture_liee_id uuid REFERENCES public.facture_evoliz(id);
COMMENT ON COLUMN public.facture_evoliz.facture_liee_id IS 'Rectificative : facture/demande à laquelle elle est rattachée (ex. demande de débours dont elle justifie les frais). sync-evoliz-statut la passe payée quand la facture liée est réglée.';
