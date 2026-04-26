-- Migration 090 : pg_cron pour sync-reviews (déclenche aussi le SMS 5★)
-- Exécute sync-reviews tous les jours à 8h00 UTC (10h heure française)
-- Nécessite : SERVICE_ROLE_KEY défini dans les secrets Edge Functions

select cron.unschedule('sync-reviews-daily')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily');

select cron.schedule(
  'sync-reviews-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/sync-reviews',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

select jobid, jobname, schedule, active from cron.job where jobname = 'sync-reviews-daily';
