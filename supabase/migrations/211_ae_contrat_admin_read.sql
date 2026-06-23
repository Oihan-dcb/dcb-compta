-- Lecture par le staff admin (PowerHouse) de tous les contrats/onboarding AE (vue de suivi).
drop policy if exists ae_contrat_select_admin on public.ae_contrat;
create policy ae_contrat_select_admin on public.ae_contrat for select to authenticated
  using (exists(select 1 from public.auto_entrepreneur a where a.ae_user_id=auth.uid() and a.acces_admin));
drop policy if exists ae_onboarding_select_admin on public.ae_onboarding;
create policy ae_onboarding_select_admin on public.ae_onboarding for select to authenticated
  using (exists(select 1 from public.auto_entrepreneur a where a.ae_user_id=auth.uid() and a.acces_admin));
