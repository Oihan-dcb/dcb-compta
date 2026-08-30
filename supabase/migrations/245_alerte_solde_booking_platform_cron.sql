-- Migration 245 : pg_cron pour alerte-solde-booking-platform
-- Failsafe : soldes booking_platform jamais confirmés + contrats annulés avec réservation
-- encore active (voir docs/invariants.md et mémoire project_contrat_annule_ne_maj_pas_reservation).
-- Même pattern que 235_alerte_solde_manuel_cron.sql. Exécution quotidienne 8h09 UTC.

select cron.unschedule('alerte-solde-booking-platform-dcb')
  where exists (select 1 from cron.job where jobname = 'alerte-solde-booking-platform-dcb');
select cron.unschedule('alerte-solde-booking-platform-lauian')
  where exists (select 1 from cron.job where jobname = 'alerte-solde-booking-platform-lauian');

select cron.schedule(
  'alerte-solde-booking-platform-dcb',
  '9 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-solde-booking-platform',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"dcb"}'::jsonb
  )
  $$
);

select cron.schedule(
  'alerte-solde-booking-platform-lauian',
  '11 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-solde-booking-platform',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb
  )
  $$
);
