-- 343 — Cron quotidien de l'edge function points-attention-avis (07/10/2026) : avis voyageurs propreté < 5/5
-- → consignes Haiku → points d'attention de l'AE (migration 342). 30 appels max par passage, un seul par avis.
select cron.unschedule('points-attention-avis') where exists (select 1 from cron.job where jobname = 'points-attention-avis');
select cron.schedule('points-attention-avis', '41 7 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/points-attention-avis',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
$$);
