-- Cron nightly : sync réservations Hospitable → Supabase
-- Tourne à 2h UTC (avant ventilation-auto à 3h UTC)
-- Scope : toutes les réservations de l'année en cours, tous les biens actifs agence dcb

select cron.schedule(
  'sync-reservations-cron',
  '0 2 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reservations-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := '{"agence":"dcb"}'::jsonb
  );
  $$
);
