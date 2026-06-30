-- 219_mandat_assurance_hab.sql
-- Mandat : attestation d'assurance habitation (PNO/MRH) du bien, fournie par le proprio
-- à la signature (obligatoire) + annexée filigranée au PDF. Déjà appliqué en prod.

alter table mandat_signature
  add column if not exists assurance_hab_path text,
  add column if not exists assurance_hab_taken_at timestamptz;
