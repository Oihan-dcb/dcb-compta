-- Pièce jointe Carte Vitale dans l'onboarding AE.
alter table public.ae_onboarding add column if not exists doc_vitale_path text;
