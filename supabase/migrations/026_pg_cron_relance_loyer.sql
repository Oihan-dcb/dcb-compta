-- Migration 026 : pg_cron relance-loyer — quotidien à 9h
--
-- Appelle l'edge function relance-loyer chaque matin à 9h.
-- La fonction vérifie les loyers en attente et envoie email + SMS.
--
-- AVANT D'EXÉCUTER :
--   Remplacer __SERVICE_ROLE_KEY__ par la clé service_role depuis :
--   Supabase Dashboard → Project Settings → API → service_role (secret)

-- Extensions requises (déjà activées via migration 021)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Supprimer le job s'il existe déjà (idempotent)
SELECT cron.unschedule('relance-loyer-quotidien')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'relance-loyer-quotidien'
);

-- Programmer l'appel chaque jour à 9h UTC (11h heure Paris en été)
SELECT cron.schedule(
  'relance-loyer-quotidien',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/relance-loyer',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Vérification
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
