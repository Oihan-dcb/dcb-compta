-- Migration 052 : sécurité RLS + Storage
-- Deux correctifs distincts, aucun impact sur le rôle anon (dcb-compta).

-- ══════════════════════════════════════════════════════════════════════════════
-- CORRECTIF A — bucket achats-documents
-- Avant : anon + authenticated peuvent tout faire (upload, delete, read)
-- Après : anon = lecture seule (bouton 📎 dcb-compta)
--         authenticated = accès complet (portail Laura)
-- ══════════════════════════════════════════════════════════════════════════════

drop policy if exists "achats_documents_all" on storage.objects;

create policy "achats_documents_anon_read" on storage.objects
  for select to anon
  using (bucket_id = 'achats-documents');

create policy "achats_documents_auth_all" on storage.objects
  for all to authenticated
  using  (bucket_id = 'achats-documents')
  with check (bucket_id = 'achats-documents');

-- ══════════════════════════════════════════════════════════════════════════════
-- CORRECTIF B — RLS tables LLD + facture_achat
-- Avant : FOR ALL TO public USING (true) → anon ET authenticated sans filtre
-- Après : anon = inchangé (accès complet, dcb-compta)
--         authenticated = seulement laura@destinationcotebasque.com
-- ══════════════════════════════════════════════════════════════════════════════

-- etudiant
drop policy if exists "open_all_etudiant" on etudiant;
create policy "anon_all_etudiant" on etudiant
  for all to anon using (true) with check (true);
create policy "auth_laura_etudiant" on etudiant
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com')
  with check ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com');

-- loyer_suivi
drop policy if exists "open_all_loyer_suivi" on loyer_suivi;
create policy "anon_all_loyer_suivi" on loyer_suivi
  for all to anon using (true) with check (true);
create policy "auth_laura_loyer_suivi" on loyer_suivi
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com')
  with check ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com');

-- virement_proprio_suivi
drop policy if exists "open_all_virement_proprio_suivi" on virement_proprio_suivi;
create policy "anon_all_virement_proprio_suivi" on virement_proprio_suivi
  for all to anon using (true) with check (true);
create policy "auth_laura_virement_proprio_suivi" on virement_proprio_suivi
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com')
  with check ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com');

-- caution_suivi
drop policy if exists "open_all_caution_suivi" on caution_suivi;
create policy "anon_all_caution_suivi" on caution_suivi
  for all to anon using (true) with check (true);
create policy "auth_laura_caution_suivi" on caution_suivi
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com')
  with check ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com');

-- etudiant_document
drop policy if exists "open_all_etudiant_document" on etudiant_document;
create policy "anon_all_etudiant_document" on etudiant_document
  for all to anon using (true) with check (true);
create policy "auth_laura_etudiant_document" on etudiant_document
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com')
  with check ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com');

-- facture_achat
drop policy if exists "open_all_facture_achat" on facture_achat;
create policy "anon_all_facture_achat" on facture_achat
  for all to anon using (true) with check (true);
create policy "auth_laura_facture_achat" on facture_achat
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com')
  with check ((auth.jwt() ->> 'email') = 'laura@destinationcotebasque.com');
