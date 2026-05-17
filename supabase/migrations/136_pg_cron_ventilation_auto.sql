-- Migration 136 : pg_cron ventilation automatique nightly
--
-- Déclenche la ventilation comptable chaque nuit à 3h UTC (5h heure Paris en été).
-- L'Edge Function ventilation-auto calcule les mois courant + 2 mois précédents
-- non clôturés, sans toucher aux mois verrouillés (cloture_ventil = true).
--
-- AVANT D'EXÉCUTER :
--   Remplacer __SERVICE_ROLE_KEY__ par la clé service_role :
--   Supabase Dashboard → Project Settings → API → service_role (secret)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Supprimer si existe déjà (idempotent)
SELECT cron.unschedule('ventilation-auto-nightly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ventilation-auto-nightly'
);

-- Ventilation nightly à 3h UTC
SELECT cron.schedule(
  'ventilation-auto-nightly',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/ventilation-auto',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body    := '{"agence":"dcb"}'::jsonb
  ) AS request_id;
  $$
);

-- Vérification
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
