-- 325 — Confidentialité des fiches staff (05/10/2026).
-- Avant : ae_select = auth_user_is_internal() → toute AE lisait les 17 fiches (IBAN, SIRET,
-- adresse, téléphone, taux, token_acces) de ses collègues.
-- Après : fiche complète = bureau, comptes PowerHouse (staff_users / acces_powerhouse, ex. Léa),
-- ou sa propre fiche (ae_user_id / linked_ae_user_id). Les autres passent par la vue ae_annuaire
-- (prénom, nom, type, flags messagerie) — utilisée par Messagerie / PageMemo / PageTechnique /
-- Portail du portail AE.
create or replace function public.auth_user_voit_fiches_ae()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid())
      or exists (
           select 1 from auto_entrepreneur a
           where a.ae_user_id = auth.uid() and a.actif
             and (a.type in ('gerant', 'assistante') or a.acces_admin or a.acces_powerhouse)
         );
$$;
revoke all on function public.auth_user_voit_fiches_ae() from public, anon;
grant execute on function public.auth_user_voit_fiches_ae() to authenticated;

drop policy if exists ae_select on public.auto_entrepreneur;
create policy ae_select on public.auto_entrepreneur for select to authenticated
  using (auth_user_voit_fiches_ae() or auth_user_owns_ae(id));

-- Annuaire interne : vue propriétaire (contourne la RLS de la table), filtrée sur les comptes internes.
create or replace view public.ae_annuaire with (security_barrier = true) as
  select id, ae_user_id, prenom, nom, type, actif, is_chat_manager, is_chat_hidden, linked_ae_user_id, saisie_heures
  from public.auto_entrepreneur
  where auth_user_is_internal();
revoke all on public.ae_annuaire from public, anon;
grant select on public.ae_annuaire to authenticated;
