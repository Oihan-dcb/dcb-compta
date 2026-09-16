-- Migration 259 : sync-reviews-daily-batch-0/1 déplacés (8h25/8h27 → 8h41/8h43)
--
-- Collision découverte le 16/09/2026 en minant la session dans MemPalace : un AUTRE travail en
-- cours sur ce même repo (migration 257_alerte_prestation_doublon_cron.sql, non liée à cette
-- session) a pris EXACTEMENT les mêmes créneaux (8h25 dcb / 8h27 lauian) que
-- sync-reviews-daily-batch-0/1 (migration 257_sync_reviews_batched_cron.sql, cette session) —
-- collision de NUMÉRO de migration (deux fichiers "257" différents, l'un par flux de travail)
-- et de CRÉNEAU cron, les deux ayant choisi indépendamment "le premier créneau libre après 8h23"
-- sans se voir. Les deux tournent sans casser l'autre (net.http_post est indépendant par job),
-- mais ça viole la convention du repo (créneaux dédiés, cf. commentaire de la migration 256) et
-- mélange les logs. On déplace seulement NOS deux jobs (aucune modification de
-- alerte-prestation-doublon-*, propriété de l'autre flux de travail).

select cron.unschedule('sync-reviews-daily-batch-0');
select cron.schedule('sync-reviews-daily-batch-0', '41 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":0,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select cron.unschedule('sync-reviews-daily-batch-1');
select cron.schedule('sync-reviews-daily-batch-1', '43 8 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-reviews',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{"offset":12,"batchSize":12}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

select jobname, schedule from cron.job where jobname like 'sync-reviews-daily%' or jobname like '%prestation-doublon%' order by schedule;
