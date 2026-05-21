-- Cron nightly : ventilation auto — agence Lauian
-- Tourne à 3h30 UTC (30 min après dcb à 3h00, après sync-reservations-cron-lauian à 2h30)

select cron.schedule(
  'ventilation-auto-nightly-lauian',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/ventilation-auto',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := '{"agence":"lauian"}'::jsonb
  ) AS request_id;
  $$
);
