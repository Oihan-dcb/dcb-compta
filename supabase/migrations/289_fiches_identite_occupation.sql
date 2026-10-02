-- Fiches propriétaire / bien peuplées par les réponses du lien d'onboarding mandat (campagne 10/2026) :
-- jusqu'ici ces informations ne vivaient que dans proprietaire_onboarding.reponses (JSON), invisibles
-- dans les fiches et perdues pour le préremplissage des mandats suivants.
ALTER TABLE public.proprietaire
  ADD COLUMN IF NOT EXISTS civilite text,
  ADD COLUMN IF NOT EXISTS date_naissance text,
  ADD COLUMN IF NOT EXISTS lieu_naissance text,
  ADD COLUMN IF NOT EXISTS nationalite text,
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS situation_matrimoniale text,
  ADD COLUMN IF NOT EXISTS conjoint_nom text;
ALTER TABLE public.bien
  ADD COLUMN IF NOT EXISTS statut_occupation text,      -- Résidence principale / annexe / secondaire / mixte / société
  ADD COLUMN IF NOT EXISTS numero_enregistrement text,  -- n° d'enregistrement meublé de tourisme (mairie)
  ADD COLUMN IF NOT EXISTS identifiant_fiscal text;
