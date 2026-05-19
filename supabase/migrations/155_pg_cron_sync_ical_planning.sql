-- Migration 155 : pg_cron sync iCal biens → planning_events (toutes les 5 min)
--
-- Déclenche sync-ical-planning pour tenir planning_events à jour.
-- Utilisé par : PowerHouse planning, portail owner, croisement ménages ↔ resas.
--
-- AVANT D'EXÉCUTER :
--   Remplacer __SERVICE_ROLE_KEY__ par la clé service_role :
--   Supabase Dashboard → Project Settings → API → service_role (secret)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Supprimer si existe déjà (idempotent)
SELECT cron.unschedule('sync-ical-planning')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-ical-planning'
);

-- Sync iCal toutes les 5 minutes
SELECT cron.schedule(
  'sync-ical-planning',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/sync-ical-planning',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Vérification
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
