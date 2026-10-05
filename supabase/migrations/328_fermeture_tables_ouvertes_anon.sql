-- 328 — Tables ouvertes au rôle public (anon compris = n'importe qui avec la clé publique),
-- trouvées le 05/10/2026 lors du scoping de Léa.
--   Financières (lecture/écriture/suppression sans connexion !) : reservation_ajustement,
--   reversement_resa, virement_sortant_controle → bureau (seul dcb-compta les lit côté client ;
--   API / edge functions en service_role, non concernées par la RLS).
--   catalogue_items / catalogue_dependances → comptes internes (PowerHouse + portail AE).
--   dispo_action_log (lecture) → staff PowerHouse ; evenement_local (lecture) → internes.
drop policy if exists anon_all_reservation_ajustement on public.reservation_ajustement;
create policy bureau_all_reservation_ajustement on public.reservation_ajustement for all to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());

drop policy if exists reversement_resa_open on public.reversement_resa;
create policy bureau_all_reversement_resa on public.reversement_resa for all to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());

drop policy if exists virement_sortant_controle_open on public.virement_sortant_controle;
create policy bureau_all_virement_sortant_controle on public.virement_sortant_controle for all to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());

drop policy if exists anon_all_catalogue_items on public.catalogue_items;
create policy internal_all_catalogue_items on public.catalogue_items for all to authenticated
  using (auth_user_is_internal()) with check (auth_user_is_internal());

drop policy if exists anon_all_catalogue_dependances on public.catalogue_dependances;
create policy internal_all_catalogue_dependances on public.catalogue_dependances for all to authenticated
  using (auth_user_is_internal()) with check (auth_user_is_internal());

drop policy if exists dispo_action_log_read_authenticated on public.dispo_action_log;
create policy dispo_action_log_read_staff on public.dispo_action_log for select to authenticated
  using (auth_user_is_staff());

drop policy if exists evenement_local_read on public.evenement_local;
create policy evenement_local_read_internal on public.evenement_local for select to authenticated
  using (auth_user_is_internal());
