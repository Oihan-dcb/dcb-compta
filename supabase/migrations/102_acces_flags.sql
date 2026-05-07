-- 102_acces_flags.sql
-- Remplace la logique type-based par deux flags de permission explicites.
-- acces_admin   : frais proprio, prestations, LLD, factures, création AE
-- saisie_heures : pointage journalier dans staff_heures_jour

ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS acces_admin   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS saisie_heures boolean NOT NULL DEFAULT false;

-- gérant et assistante ont accès admin
UPDATE auto_entrepreneur SET acces_admin = true  WHERE type IN ('gerant', 'assistante');
-- gérant et staff peuvent saisir des heures
UPDATE auto_entrepreneur SET saisie_heures = true WHERE type IN ('gerant', 'staff');
-- Laura : AE avec accès admin complet (DCB + Lauian) et saisie d'heures
UPDATE auto_entrepreneur
  SET acces_admin = true, saisie_heures = true
  WHERE email = 'laura@destinationcotebasque.com';
