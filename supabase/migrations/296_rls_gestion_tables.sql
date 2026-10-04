-- 296 — RLS des tables de gestion (02/10/2026, validé par Oïhan)
-- Avant : auth_user_is_staff() = staff_users OU fiche auto_entrepreneur de type <> 'ae' OU acces_admin
-- OU acces_powerhouse, SANS contrôle de actif → un staff terrain, un compte désactivé et un accès
-- PowerHouse géo-restreint avaient ALL sur loyers, cautions, étudiants, virements proprio, frais
-- proprios, factures d'achat. communs_maite_solde et prestation_type étaient en ALL pour tout AE.
-- Après : auth_user_is_gestion() = staff_users OU fiche ACTIVE gérant/assistante/acces_admin
-- (= les profils qui avaient l'onglet Gestion du portail).

create or replace function public.auth_user_is_gestion()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid())
      or exists (
           select 1 from auto_entrepreneur a
           where a.ae_user_id = auth.uid() and a.actif
             and (a.type in ('gerant','assistante') or a.acces_admin)
         );
$$;
revoke all on function public.auth_user_is_gestion() from public, anon;
grant execute on function public.auth_user_is_gestion() to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('loyer_suivi','staff_all_loyer_suivi'),
    ('etudiant','etudiant_staff_all'),
    ('etudiant_document','staff_all_etudiant_document'),
    ('caution_suivi','staff_all_caution_suivi'),
    ('virement_proprio_suivi','staff_all_virement_proprio_suivi'),
    ('lld_log','staff_all_lld_log'),
    ('lld_mouvement_bancaire','staff_all_lld_mouvement_bancaire'),
    ('facture_achat','staff_all_facture_achat'),
    ('frais_proprietaire','staff_all_frais_proprietaire'),
    ('communs_maite_solde','internal_all_communs_maite_solde')
  ) as t(tbl, pol)
  loop
    execute format('drop policy if exists %I on public.%I', r.pol, r.tbl);
    execute format('drop policy if exists %I on public.%I', 'gestion_all_'||r.tbl, r.tbl);
    execute format('create policy %I on public.%I for all to authenticated using (auth_user_is_gestion()) with check (auth_user_is_gestion())', 'gestion_all_'||r.tbl, r.tbl);
  end loop;
end $$;

-- prestation_type : lecture pour tout compte interne (les AE choisissent le type de leurs extras),
-- écriture réservée à la gestion.
drop policy if exists internal_all_prestation_type on public.prestation_type;
drop policy if exists internal_read_prestation_type on public.prestation_type;
drop policy if exists gestion_write_prestation_type on public.prestation_type;
create policy internal_read_prestation_type on public.prestation_type for select to authenticated using (auth_user_is_internal());
create policy gestion_write_prestation_type on public.prestation_type for all to authenticated using (auth_user_is_gestion()) with check (auth_user_is_gestion());

-- Storage : etudiant-documents (baux, EDL, pièces d'identité, quittances) était lisible par TOUT LE MONDE
-- (policy public_read, rôle public = anon compris) ; achats-documents lisible en anon et ALL pour tout
-- authentifié (dont les ~33 comptes propriétaires). Les deux buckets sont privés : les edge functions
-- passent par service_role (inchangé). → gestion uniquement.
drop policy if exists public_read on storage.objects;
drop policy if exists authenticated_read_etudiant_documents on storage.objects;
drop policy if exists achats_documents_anon_read on storage.objects;
drop policy if exists achats_documents_auth_all on storage.objects;
drop policy if exists gestion_all_etudiant_documents on storage.objects;
drop policy if exists gestion_all_achats_documents on storage.objects;
create policy gestion_all_etudiant_documents on storage.objects for all to authenticated
  using (bucket_id = 'etudiant-documents' and public.auth_user_is_gestion())
  with check (bucket_id = 'etudiant-documents' and public.auth_user_is_gestion());
create policy gestion_all_achats_documents on storage.objects for all to authenticated
  using (bucket_id = 'achats-documents' and public.auth_user_is_gestion())
  with check (bucket_id = 'achats-documents' and public.auth_user_is_gestion());
