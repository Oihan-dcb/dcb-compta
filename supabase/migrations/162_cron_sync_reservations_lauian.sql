-- Cron nightly : sync réservations Hospitable → Supabase — agence Lauian
-- Tourne à 2h30 UTC (30 min après dcb, avant ventilation-auto à 3h)

select cron.schedule(
  'sync-reservations-cron-lauian',
  '30 2 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reservations-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := '{"agence":"lauian"}'::jsonb
  );
  $$
);
