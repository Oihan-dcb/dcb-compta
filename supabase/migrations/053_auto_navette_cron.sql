-- Migration 053 : pg_cron auto-envoi navette J-2 fin de mois
--
-- Appelle auto-navette-mensuelle le 28 de chaque mois à 8h UTC (10h Paris été)
-- pour tous les staff avec auto_send_navette = true.
-- Le 28 est safe pour tous les mois : J-3 pour mois à 31j, J-2 pour mois à 30j.
--
-- AVANT D'EXÉCUTER :
--   Remplacer __SERVICE_ROLE_KEY__ par la clé service_role depuis :
--   Supabase Dashboard → Project Settings → API → service_role (secret)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('auto-navette-mensuelle')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-navette-mensuelle'
);

SELECT cron.schedule(
  'auto-navette-mensuelle',
  '0 8 28 * *',
  $$
  SELECT net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/auto-navette-mensuelle',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
