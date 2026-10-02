-- Selfie de vérification d'identité à la signature du mandat (demande Oïhan 02/10/2026), stocké dans le
-- bucket privé « mandats » comme la CNI ; non annexé au PDF (vérification interne uniquement).
ALTER TABLE public.mandat_signature
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS selfie_taken_at timestamptz;
