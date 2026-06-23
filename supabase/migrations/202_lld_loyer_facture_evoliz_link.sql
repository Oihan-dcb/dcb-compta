-- Phase 2 LLD : lien loyer_suivi → facture_evoliz (facture d'honoraires LLD, type_facture='lld').
-- Traçabilité + éviter de re-facturer un loyer. Renseigné par genererFacturesLLD (src/services/facturesLLD.js).
-- (Déjà appliqué en prod via MCP le 2026-06-23 ; fichier ajouté pour traçabilité repo.)

alter table loyer_suivi add column if not exists facture_evoliz_id uuid references facture_evoliz(id) on delete set null;
comment on column loyer_suivi.facture_evoliz_id is
  'Facture honoraires LLD (facture_evoliz.type_facture=lld) couvrant ce loyer. Renseigné par genererFacturesLLD.';
