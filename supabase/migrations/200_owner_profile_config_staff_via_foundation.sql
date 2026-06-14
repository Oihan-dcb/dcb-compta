-- Aligner owner_profile_config sur la fondation auth_user_is_staff() (staff_users OU AE actif).
-- L'ancien check inline (auto_entrepreneur actif) bloquait les staff sans fiche AE (ex. Laura)
-- → "new row violates row-level security policy for table owner_profile_config" en édition proprio.
alter policy "staff_manage_owner_profile" on owner_profile_config
  using (public.auth_user_is_staff())
  with check (public.auth_user_is_staff());

alter policy "staff_read_all_owner_config" on owner_profile_config
  using (public.auth_user_is_staff());
