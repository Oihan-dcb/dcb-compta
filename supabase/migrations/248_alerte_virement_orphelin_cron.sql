-- Migration 248 : pg_cron pour alerte-virement-orphelin
-- Failsafe demandé par Oïhan le 09/09/2026 : virement OTA (Airbnb/Booking) entrant sur le
-- séquestre sans réservation associée (statut_matching='non_identifie') — cas type : un
-- propriétaire passe de gestion_loyer=false à true après que ses résas aient déjà été
-- synchronisées, le virement réel n'a alors rien à quoi se rattacher.
-- Même pattern que 235_alerte_solde_manuel_cron.sql / 245_alerte_solde_booking_platform_cron.sql.
-- Exécution quotidienne 8h13 UTC (dcb) / 8h15 UTC (lauian).

select cron.unschedule('alerte-virement-orphelin-dcb')
  where exists (select 1 from cron.job where jobname = 'alerte-virement-orphelin-dcb');
select cron.unschedule('alerte-virement-orphelin-lauian')
  where exists (select 1 from cron.job where jobname = 'alerte-virement-orphelin-lauian');

select cron.schedule(
  'alerte-virement-orphelin-dcb',
  '13 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-virement-orphelin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"dcb"}'::jsonb
  )
  $$
);

select cron.schedule(
  'alerte-virement-orphelin-lauian',
  '15 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-virement-orphelin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb
  )
  $$
);
