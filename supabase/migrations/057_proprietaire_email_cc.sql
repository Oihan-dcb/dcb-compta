-- Ajout du champ email_cc sur la table proprietaire
-- Permet de définir une adresse email en copie (ex: conjoint, gestionnaire)
-- Utilisé lors des envois de rapports propriétaires

ALTER TABLE proprietaire ADD COLUMN IF NOT EXISTS email_cc text;
