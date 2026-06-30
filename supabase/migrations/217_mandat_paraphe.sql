-- 217_mandat_paraphe.sql
-- Paraphe (initiales) des signataires du mandat — tamponnée en Northwell sur chaque page.
-- Déjà appliqué en prod ; reproductible.

alter table mandat_signature
  add column if not exists paraphe text,            -- paraphe du mandant
  add column if not exists apporteur_paraphe text;  -- paraphe de l'apporteur (Léa)
