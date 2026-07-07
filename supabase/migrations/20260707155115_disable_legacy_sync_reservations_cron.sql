-- Incident 2026-07-07 : le cron pg_cron sync-reservations-cron (Edge Function Deno) tournait
-- chaque nuit en doublon avec le cron Vercel /api/sync-reservations, censé l'avoir remplacé
-- depuis le refactor "unifier sync reservations — UI appelle le serveur" (commit 2db85b9,
-- mars 2026). Les deux créaient chacun un payout_hospitable synthétique Airbnb avec une clé
-- différente (hospitable_id externe vs id interne) -> 234 résas avec payout en double, dont
-- 2 avec un vrai virement bancaire distinct capté par erreur (revenu d'une autre résa).
-- Nettoyage des données fait en direct, fix de la clé dans api/sync-reservations.js.
-- Cette migration documente la désactivation des jobs, déjà appliquée en direct via
-- cron.unschedule() au moment de l'incident (idempotente si rejouée).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-reservations-cron') THEN
    PERFORM cron.unschedule('sync-reservations-cron');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-reservations-cron-lauian') THEN
    PERFORM cron.unschedule('sync-reservations-cron-lauian');
  END IF;
END $$;
