-- Supprime la colonne mdp_temporaire de auto_entrepreneur.
-- Le système utilise désormais des recovery links (create-ae-user/reset-ae-password).
-- Les mots de passe temporaires stockés ici sont devenus obsolètes.

ALTER TABLE auto_entrepreneur DROP COLUMN IF EXISTS mdp_temporaire;
