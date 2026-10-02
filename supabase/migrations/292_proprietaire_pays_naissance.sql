-- Pays de naissance (mandat : « né(e) le … à <lieu> (<pays>) »), saisi dans le lien d'onboarding.
ALTER TABLE public.proprietaire ADD COLUMN IF NOT EXISTS pays_naissance text;
