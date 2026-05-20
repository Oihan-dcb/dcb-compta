-- Cron nightly : ventilation auto — agence Lauian
-- Tourne à 3h30 UTC (30 min après dcb à 3h00, après sync-reservations-cron-lauian à 2h30)

select cron.schedule(
  'ventilation-auto-nightly-lauian',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/ventilation-auto',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __REDACTED_SERVICE_ROLE_JWT__"}'::jsonb,
    body    := '{"agence":"lauian"}'::jsonb
  ) AS request_id;
  $$
);
