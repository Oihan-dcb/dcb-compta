-- 329 — Comptes PowerHouse scopés (acces_powerhouse, ex. Léa) limités à leur périmètre sur les
-- tables qu'ils lisaient encore pour TOUTES les agences (05/10/2026, « scope Léa »).
-- Bureau inchangé. Le périmètre est hérité des tables mères déjà scopées par secteur :
-- rental_contracts (contrats), proprietaire (propriétaires), bien (my_scoped_bien_ids).
alter policy staff_select_contract_alerts on public.contract_alerts
  using (auth_user_is_bureau() or (auth_user_is_staff() and contract_id in (select id from rental_contracts)));
alter policy staff_select_contract_events on public.contract_events
  using (auth_user_is_bureau() or (auth_user_is_staff() and contract_id in (select id from rental_contracts)));
alter policy staff_select_contract_payments on public.contract_payments
  using (auth_user_is_bureau() or (auth_user_is_staff() and contract_id in (select id from rental_contracts)));
alter policy contract_sign_sessions_staff_select on public.contract_sign_sessions
  using (auth_user_is_bureau() or (auth_user_is_staff() and contract_id in (select id from rental_contracts)));
alter policy staff_select_payment_guarantees on public.payment_guarantees
  using (auth_user_is_bureau() or (auth_user_is_staff() and contract_id in (select id from rental_contracts)));

alter policy staff_all_hospitable_messages on public.hospitable_messages
  using (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))))
  with check (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))));

alter policy mandat_lien_staff_all on public.mandat_lien
  using (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()) or proprietaire_id in (select id from proprietaire))))
  with check (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()) or proprietaire_id in (select id from proprietaire))));

alter policy staff_select_mailing_open on public.mailing_open
  using (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)));

alter policy staff_manage_owner_profile on public.owner_profile_config
  using (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)))
  with check (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)));
alter policy staff_read_all_owner_config on public.owner_profile_config
  using (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)));

alter policy onboarding_staff_all on public.proprietaire_onboarding
  using (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)))
  with check (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)));
alter policy onboarding_select on public.proprietaire_onboarding
  using (auth_user_is_bureau() or (auth_user_is_staff() and proprietaire_id in (select id from proprietaire)) or proprietaire_id in (select my_proprietaire_ids()));

alter policy error_log_select_staff on public.app_error_log using (auth_user_is_bureau());
