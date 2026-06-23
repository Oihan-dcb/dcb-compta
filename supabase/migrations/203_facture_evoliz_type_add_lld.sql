-- Phase 2 LLD : autoriser type_facture='lld' (factures d'honoraires locations longue durée).
-- (Déjà appliqué en prod via MCP le 2026-06-23.)

alter table facture_evoliz drop constraint if exists facture_evoliz_type_check;
alter table facture_evoliz add constraint facture_evoliz_type_check
  check (type_facture = any (array['honoraires'::text, 'debours'::text, 'com'::text, 'lauian_fmen'::text, 'lld'::text]));
