-- Opt-in envoi automatique fiche navette le dernier jour du mois
ALTER TABLE auto_entrepreneur
  ADD COLUMN IF NOT EXISTS auto_send_navette boolean NOT NULL DEFAULT false;
