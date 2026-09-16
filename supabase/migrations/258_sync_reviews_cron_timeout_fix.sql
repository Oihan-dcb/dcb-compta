-- Migration 258 : net.http_post a un timeout par défaut de 5000ms (5s) — bien trop court pour un
-- lot de 12 biens (fetch avis Hospitable + upserts + dedup SMS par avis, peut prendre 60-120s).
-- Découvert en testant manuellement la migration 257 : les 8 requêtes déclenchées à la main sont
-- toutes timeout à exactement 5000ms côté pg_net (net._http_response.error_msg = "Timeout of
-- 5000 ms reached"). Ajout du 5e paramètre timeout_milliseconds=120000 (120s, sous le idle
-- timeout ~150s de l'Edge Function) sur les 8 jobs de la migration 257.

select cron.unschedule('sync-reviews-daily-batch-0');
select cron.schedule('sync-reviews-daily-batch-0', '25 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":0,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-1');
select cron.schedule('sync-reviews-daily-batch-1', '27 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":12,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-2');
select cron.schedule('sync-reviews-daily-batch-2', '29 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":24,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-3');
select cron.schedule('sync-reviews-daily-batch-3', '31 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":36,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-4');
select cron.schedule('sync-reviews-daily-batch-4', '33 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":48,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-5');
select cron.schedule('sync-reviews-daily-batch-5', '35 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":60,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-6');
select cron.schedule('sync-reviews-daily-batch-6', '37 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":72,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-7');
select cron.schedule('sync-reviews-daily-batch-7', '39 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":84,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);
