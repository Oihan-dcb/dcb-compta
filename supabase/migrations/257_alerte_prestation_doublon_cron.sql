-- Migration 257 : pg_cron pour alerte-prestation-doublon
--
-- Garde-fou demandé par Oïhan le 16/09/2026, suite à l'incident ONGI : une prestation
-- hors forfait (dcb_direct, 12,50 €) saisie deux fois à 62 secondes d'écart (double-clic),
-- restée en double pendant des semaines sans que personne ne s'en aperçoive. Laura a cru
-- avoir supprimé le doublon après la clôture du bien/mois, ce qui n'a jamais eu lieu :
-- aucun DELETE réel n'existe côté UI pour prestation_hors_forfait (seulement un
-- soft-cancel via statut='annule'), et un vrai DELETE aurait de toute façon été bloqué
-- sans exception par check_cloture_bien_fige.
--
-- Même pattern que 256_alerte_mission_menage_orpheline_cron.sql : une Edge Function
-- partagée, deux jobs distincts qui passent l'agence dans le body.
-- Exécution quotidienne 8h25 UTC (dcb) / 8h27 UTC (lauian).
--
-- Lecture seule sur les données métier : la fonction n'écrit que sa ligne d'audit journal_ops.

select cron.unschedule('alerte-prestation-doublon-dcb')
  where exists (select 1 from cron.job where jobname = 'alerte-prestation-doublon-dcb');
select cron.unschedule('alerte-prestation-doublon-lauian')
  where exists (select 1 from cron.job where jobname = 'alerte-prestation-doublon-lauian');

select cron.schedule(
  'alerte-prestation-doublon-dcb',
  '25 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-prestation-doublon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"dcb"}'::jsonb,
    timeout_milliseconds := 30000
  )
  $$
);

select cron.schedule(
  'alerte-prestation-doublon-lauian',
  '27 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-prestation-doublon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb,
    timeout_milliseconds := 30000
  )
  $$
);
