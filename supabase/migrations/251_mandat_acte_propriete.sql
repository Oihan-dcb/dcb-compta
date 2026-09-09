-- 251_mandat_acte_propriete.sql
-- Acte de propriété (justificatif de propriété), même pattern que RIB (221) : demandé et
-- bloquant à la signature, annexé filigrané au PDF final. Demandé par Oïhan après test réel
-- 09/09/2026 : besoin de savoir "à qui" appartient le bien, preuve documentaire.
alter table mandat_signature
  add column if not exists acte_propriete_path      text,
  add column if not exists acte_propriete_taken_at   timestamptz;
