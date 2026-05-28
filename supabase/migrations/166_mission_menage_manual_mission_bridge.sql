-- Migration 166 : bridge mission_menage ↔ manual_missions
--
-- Ajoute manual_mission_id sur mission_menage pour lier une mission ménage portail AE
-- à la mission manuelle PowerHouse correspondante (même bien, même date).
-- Lien optionnel — null si pas de mission PowerHouse créée.
-- ON DELETE SET NULL : si la mission PowerHouse est supprimée, le lien disparaît.

ALTER TABLE mission_menage
  ADD COLUMN IF NOT EXISTS manual_mission_id uuid REFERENCES manual_missions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mission_menage_manual_mission_id
  ON mission_menage(manual_mission_id)
  WHERE manual_mission_id IS NOT NULL;

-- Policy RLS : mission_menage UPDATE existant (migration 132) couvre déjà le nouveau champ
-- Pas de migration RLS supplémentaire nécessaire.
