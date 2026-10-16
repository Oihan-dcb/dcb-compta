-- 439 — Journal des purges d'identité : accepte les attestations d'assurance voyageurs (16/10/2026).
-- Suppression, décidée par Oïhan, des pièces de test / de contrats supprimés restantes (API Storage, jamais de DELETE SQL
-- sur storage.objects) : 4 fichiers d'identité, 8 PDF de contrats supprimés, attestations d'assurance sans référence.
alter table public.identite_purge_journal drop constraint if exists identite_purge_journal_piece_check;
alter table public.identite_purge_journal add constraint identite_purge_journal_piece_check
  check (piece in ('selfie', 'piece_identite', 'pdf_signe', 'assurance'));
