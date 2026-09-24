-- Migration 264 : ventilation nocturne M-1 / M / M+1 pour les DEUX agences, APRÈS les synchros
-- (audit segment Ventilation, 24/09/2026 — I-151).
--
-- Avant : dcb = M (03:00) + M+1 (03:15), lauian = M seul (03:30). Aucun job ne ventilait M-1 —
-- le mois qu'on facture début M — alors que sync-reservations le resynchronise chaque nuit (et
-- M-2). Un changement sur M-1 (résolution Airbnb, annulation, modif de prix) arrivait en base sans
-- jamais être ventilé avant la génération des factures du 6 : mécanique exacte de l'incident VIKY
-- (résolution de juillet connue en août, facture juillet du 06/08 calculée sur l'ancien revenu).
-- En plus, le job de 03:00 tournait en même temps que la synchro (03:00-03:25).
--
-- Sécurité : le verrou par bien (I-146) et check_cloture_bien_fige protègent toujours les mois
-- déjà facturés ; tout écart y est signalé par alerte-changement-post-facture (I-144).
-- Créneaux : syncs Vercel 03:00-03:25 ; update-ventilation-auto-backstop 04:00 (inchangé).

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname IN
    ('ventilation-auto-nightly', 'ventilation-auto-nightly-next-month', 'ventilation-auto-nightly-lauian')
  LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._planifier_ventilation_auto(p_nom text, p_horaire text, p_agence text, p_decalage int)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM cron.schedule(p_nom, p_horaire, format($cmd$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/ventilation-auto',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := jsonb_build_object('agence', %L, 'mois', to_char(now() + interval '%s month', 'YYYY-MM'))
  ) AS request_id;
  $cmd$, p_agence, p_decalage));
END;
$fn$;

SELECT public._planifier_ventilation_auto('ventilation-auto-dcb-m-1',    '32 3 * * *', 'dcb',    -1);
SELECT public._planifier_ventilation_auto('ventilation-auto-dcb-m',      '36 3 * * *', 'dcb',     0);
SELECT public._planifier_ventilation_auto('ventilation-auto-dcb-m+1',    '40 3 * * *', 'dcb',     1);
SELECT public._planifier_ventilation_auto('ventilation-auto-lauian-m-1', '44 3 * * *', 'lauian', -1);
SELECT public._planifier_ventilation_auto('ventilation-auto-lauian-m',   '48 3 * * *', 'lauian',  0);
SELECT public._planifier_ventilation_auto('ventilation-auto-lauian-m+1', '52 3 * * *', 'lauian',  1);

DROP FUNCTION public._planifier_ventilation_auto(text, text, text, int);
