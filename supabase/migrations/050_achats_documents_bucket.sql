-- Migration 050 : bucket Supabase Storage pour les factures d'achat Laura
-- Séparé du bucket etudiant-documents qui contient les documents locataires

insert into storage.buckets (id, name, public)
values ('achats-documents', 'achats-documents', false)
on conflict (id) do nothing;

-- Accès complet pour les utilisateurs authentifiés et anon (portail Laura)
create policy "achats_documents_all" on storage.objects
  for all to anon, authenticated
  using  (bucket_id = 'achats-documents')
  with check (bucket_id = 'achats-documents');
