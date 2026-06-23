-- Lecture de mailing_open par le staff authentifié (vue "Taux d'ouverture" PowerHouse).
-- Les inserts/updates restent réservés au service_role (endpoints owner-mailing / mail-open).
drop policy if exists mailing_open_select_auth on public.mailing_open;
create policy mailing_open_select_auth
  on public.mailing_open for select to authenticated using (true);
