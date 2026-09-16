-- Migration 257 : sync-reviews en 8 lots batchés au lieu d'un seul appel
--
-- Bug trouvé le 16/09/2026 (Laura → Oïhan : erreurs d'analyse IA dans les rapports proprios,
-- l'IA niait l'existence d'avis pourtant réels pour Folle-brise/Miramarvel/Eneko). Cause racine :
-- le cron sync-reviews-daily (migration 090) appelait l'Edge Function avec body='{}' — donc
-- offset=0, batchSize=allBiens.length (87 biens en un seul appel). La fonction boucle
-- séquentiellement bien par bien (fetchAll paginé + upsert + 2 requêtes SMS par avis) et se fait
-- tuer par le idle timeout (~150s) après une vingtaine de biens seulement. Les biens triés par
-- `.order('id')` (uuid) au-delà de ce rang ne sont donc JAMAIS synchronisés depuis le backfill
-- manuel du 12/07/2026 — confirmé en base : dernier insert d'avis pour Miramarvel/Eneko/Folle-brise
-- daté du 12/07, alors que Hospitable a bien de nouveaux avis (dont un 3★ Eneko jamais vu).
--
-- Le mécanisme offset/batchSize existe déjà dans l'Edge Function (construit pour CE backfill
-- manuel) — jamais branché sur le cron lui-même. Ce correctif découpe le cron quotidien en 8 lots
-- de 12 biens (couvre jusqu'à 96 biens, marge au-dessus des 87 actuels), espacés de 2 minutes
-- (8h25 → 8h39 UTC, créneaux libres). Chaque lot reste largement sous le budget de temps d'un
-- seul lot de ~20 biens qui plantait.

select cron.unschedule('sync-reviews-daily')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily');

select cron.unschedule('sync-reviews-daily-batch-0')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-0');
select cron.schedule(
  'sync-reviews-daily-batch-0',
  '25 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":0,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-1')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-1');
select cron.schedule(
  'sync-reviews-daily-batch-1',
  '27 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":12,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-2')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-2');
select cron.schedule(
  'sync-reviews-daily-batch-2',
  '29 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":24,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-3')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-3');
select cron.schedule(
  'sync-reviews-daily-batch-3',
  '31 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":36,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-4')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-4');
select cron.schedule(
  'sync-reviews-daily-batch-4',
  '33 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":48,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-5')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-5');
select cron.schedule(
  'sync-reviews-daily-batch-5',
  '35 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":60,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-6')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-6');
select cron.schedule(
  'sync-reviews-daily-batch-6',
  '37 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":72,"batchSize":12}'::jsonb
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-7')
  where exists (select 1 from cron.job where jobname = 'sync-reviews-daily-batch-7');
select cron.schedule(
  'sync-reviews-daily-batch-7',
  '39 8 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"offset":84,"batchSize":12}'::jsonb
  )
  $$
);

select jobname, schedule, active from cron.job where jobname like 'sync-reviews-daily%' order by jobname;
