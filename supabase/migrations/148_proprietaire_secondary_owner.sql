-- Migration 148: Accès secondaire portail owner
-- Permet de rattacher un proprio "secondaire" à un principal
-- Le secondaire voit les mêmes biens/données que le principal via le portail

ALTER TABLE proprietaire
  ADD COLUMN parent_proprietaire_id uuid REFERENCES proprietaire(id) ON DELETE SET NULL;

CREATE INDEX idx_proprietaire_parent_id ON proprietaire(parent_proprietaire_id)
  WHERE parent_proprietaire_id IS NOT NULL;
