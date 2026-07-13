-- Migration 235 : pg_cron pour alerte-solde-manuel (failsafe soldes résas manuelles/directes)
-- Deux jobs distincts (comme ventilation-auto) : un seul Edge Function partagé, agence
-- passée dans le body du cron. Exécution quotidienne 8h05 UTC.

select cron.unschedule('alerte-solde-manuel-dcb')
  where exists (select 1 from cron.job where jobname = 'alerte-solde-manuel-dcb');
select cron.unschedule('alerte-solde-manuel-lauian')
  where exists (select 1 from cron.job where jobname = 'alerte-solde-manuel-lauian');

select cron.schedule(
  'alerte-solde-manuel-dcb',
  '5 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-solde-manuel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"dcb"}'::jsonb
  )
  $$
);

select cron.schedule(
  'alerte-solde-manuel-lauian',
  '7 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-solde-manuel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb
  )
  $$
);
