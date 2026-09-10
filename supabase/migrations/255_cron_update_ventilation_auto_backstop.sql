-- Cron de rattrapage : update-ventilation-auto (montant_reel AUTO/FMEN)
--
-- update-ventilation-auto (Edge Function) reporte le coût réel des missions
-- mission_menage vers ventilation.montant_reel (AUTO) + le FMEN dérivé — mais
-- n'est déclenché qu'en temps réel, une seule fois, par le portail AE externe
-- (dcb-portail-ae) quand une mission est saisie/validée. Si cet appel arrive
-- AVANT que la ligne ventilation AUTO existe pour la résa (fenêtre entre la
-- saisie AE et le cron ventilation-auto-nightly, ou mission liée plus tard),
-- il est ignoré silencieusement (action:'skipped') et JAMAIS retenté — le
-- montant_reel reste bloqué à NULL indéfiniment même si la mission est
-- ensuite correctement liée et validée (cas réel : Maison Txoria/Lauian,
-- 10/09/2026 — 3 missions valide+liées, montant_reel toujours NULL).
--
-- Ce cron rejoue update-ventilation-auto en mode batch ({mois: 'YYYY-MM'})
-- pour le mois courant + les 2 mois précédents (même fenêtre que
-- ventilation-auto-nightly), chaque nuit à 4h UTC — après les crons
-- ventilation-auto (3h00 dcb) et ventilation-auto-lauian (3h30), pour que les
-- lignes AUTO existent déjà quand ce rattrapage tourne. La fonction est
-- idempotente (skip si reelActuel === totalReel) et respecte cloture_bien —
-- rejouer un mois déjà à jour ou clôturé ne fait rien.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('update-ventilation-auto-backstop')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'update-ventilation-auto-backstop'
);

SELECT cron.schedule(
  'update-ventilation-auto-backstop',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/update-ventilation-auto',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := jsonb_build_object('mois', to_char(gs, 'YYYY-MM'))
  ) AS request_id
  FROM generate_series(
    date_trunc('month', now()) - interval '2 months',
    date_trunc('month', now()),
    interval '1 month'
  ) AS gs
  $$
);

-- Vérification
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE '%ventilation-auto%' ORDER BY jobid;
