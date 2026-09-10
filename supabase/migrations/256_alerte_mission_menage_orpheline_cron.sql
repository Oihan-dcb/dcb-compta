-- Migration 256 : pg_cron pour alerte-mission-menage-orpheline
--
-- Failsafe demandé par Oïhan le 10/09/2026, suite à l'incident TXORIA : une mission de ménage
-- réelle (mission_menage, 100,00 €, AE externe, statut 'valide') est restée reservation_id=NULL
-- pendant des semaines — ménage de départ réalisé en 2 temps (16 et 17 août) sur une résa de
-- mois comptable juillet, jamais rattaché par sync-ical-ae (matchResa ne regarde que
-- departure_date = date_mission ou date_mission+1).
-- Conséquence : facturesEvoliz.js ne lit que ventilation.AUTO, qui n'existe que par réservation
-- → coût AE payé par DCB et refacturé à AUCUN propriétaire, sans aucun contrôle systématique.
--
-- Même pattern que 235_alerte_solde_manuel_cron.sql / 245_alerte_solde_booking_platform_cron.sql
-- / 248_alerte_virement_orphelin_cron.sql / 249_alerte_encaissement_proprio_incoherent_cron.sql :
-- une Edge Function partagée, deux jobs distincts qui passent l'agence dans le body.
-- Exécution quotidienne 8h21 UTC (dcb) / 8h23 UTC (lauian) — créneaux libres après 8h19.
--
-- Lecture seule sur les données métier : la fonction n'écrit que sa ligne d'audit journal_ops.

select cron.unschedule('alerte-mission-menage-orpheline-dcb')
  where exists (select 1 from cron.job where jobname = 'alerte-mission-menage-orpheline-dcb');
select cron.unschedule('alerte-mission-menage-orpheline-lauian')
  where exists (select 1 from cron.job where jobname = 'alerte-mission-menage-orpheline-lauian');

select cron.schedule(
  'alerte-mission-menage-orpheline-dcb',
  '21 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-mission-menage-orpheline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"dcb"}'::jsonb
  )
  $$
);

select cron.schedule(
  'alerte-mission-menage-orpheline-lauian',
  '23 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-mission-menage-orpheline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb
  )
  $$
);
