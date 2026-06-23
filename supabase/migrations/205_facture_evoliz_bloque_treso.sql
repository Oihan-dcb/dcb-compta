-- Phase 2 LLD : facture générée mais bloquée car loyer non encaissé (pas de preuve tréso).
-- Visible dans la liste (badge "bloquée"), exclue de la validation et du push Evoliz.
-- Levée automatiquement par genererFacturesLLD quand le loyer passe 'recu'.
-- (Déjà appliqué en prod via MCP le 2026-06-23 ; fichier ajouté pour traçabilité repo.)

alter table facture_evoliz add column if not exists bloque_treso boolean not null default false;
comment on column facture_evoliz.bloque_treso is
  'Facture LLD générée sur un loyer non encaissé (attendu/en_retard) : bloquée tant que le loyer n''est pas reçu. Exclue du push Evoliz. Levée par genererFacturesLLD au passage en recu.';
