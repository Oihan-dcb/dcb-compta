-- Migration 021 : pg_cron pour process-sms-queue
-- Déclenche automatiquement l'envoi des SMS en attente toutes les 5 minutes.
--
-- AVANT D'EXÉCUTER :
--   Remplacer __SERVICE_ROLE_KEY__ par la vraie clé depuis :
--   Supabase Dashboard → Project Settings → API → service_role (secret)

-- Extensions requises (activées au niveau projet dans Supabase Cloud)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Supprimer le job s'il existe déjà (idempotent)
select cron.unschedule('process-sms-queue-every-5min')
where exists (
  select 1 from cron.job where jobname = 'process-sms-queue-every-5min'
);

-- Programmer l'appel toutes les 5 minutes
select cron.schedule(
  'process-sms-queue-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/process-sms-queue',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- Vérification : lister les jobs actifs
select jobid, jobname, schedule, active from cron.job order by jobid;
