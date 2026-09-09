-- 221_mandat_rib.sql
-- Mandat : RIB (IBAN) du propriétaire, fourni à la signature (obligatoire, comme CNI/assurance)
-- + annexé filigrané au PDF, même pattern que assurance_hab (219).

alter table mandat_signature
  add column if not exists rib_path      text,
  add column if not exists rib_taken_at  timestamptz;
