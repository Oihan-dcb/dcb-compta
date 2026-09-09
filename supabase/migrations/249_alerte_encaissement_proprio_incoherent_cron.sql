-- Migration 249 : pg_cron pour alerte-encaissement-proprio-incoherent
-- Failsafe demandé par Oïhan le 09/09/2026, suite à l'incident ITS "Itsasarte" : détecte les
-- réservations rapprochées (virement bancaire réel identifié) sur un bien gestion_loyer=false
-- ("le propriétaire encaisse directement") — signe qu'un bien a changé de circuit
-- d'encaissement côté Hospitable/Airbnb sans que la fiche bien soit mise à jour, laissant un
-- vrai reversement propriétaire jamais calculé ni versé.
-- Complémentaire à alerte-virement-orphelin (247/248) : celui-là détecte l'inverse (virement
-- qui n'a PU être rattaché à aucune résa).
-- Exécution quotidienne 8h17 UTC (dcb) / 8h19 UTC (lauian).

select cron.unschedule('alerte-encaissement-proprio-incoherent-dcb')
  where exists (select 1 from cron.job where jobname = 'alerte-encaissement-proprio-incoherent-dcb');
select cron.unschedule('alerte-encaissement-proprio-incoherent-lauian')
  where exists (select 1 from cron.job where jobname = 'alerte-encaissement-proprio-incoherent-lauian');

select cron.schedule(
  'alerte-encaissement-proprio-incoherent-dcb',
  '17 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-encaissement-proprio-incoherent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"dcb"}'::jsonb
  )
  $$
);

select cron.schedule(
  'alerte-encaissement-proprio-incoherent-lauian',
  '19 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-encaissement-proprio-incoherent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb
  )
  $$
);
