-- Biens exclus de l'enchaînement automatique des mandats (à la signature d'un mandat, l'app envoie le
-- lien d'onboarding du bien suivant du même propriétaire) : bien parti mais encore en ligne côté
-- Hospitable, famille / perso, chambres couvertes par le mandat de la maison (Maison Maïté).
ALTER TABLE public.bien ADD COLUMN IF NOT EXISTS hors_mandat boolean NOT NULL DEFAULT false;
UPDATE public.bien SET hors_mandat = true
WHERE agence = 'dcb' AND code IN ('ZURBIAC','AITA','BIXINTXO','GAXUXA','IBANETA','PANTXIKA','TXOMIN','ARREBA','VILLA AGERREA','BDX','ONTZI');
