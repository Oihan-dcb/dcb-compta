-- Migration 265 : alerte quotidienne « relevé bancaire muet » (audit segment Banque, I-152)
-- Créneau 8h49 UTC, libre (après alerte-changement-post-facture 8h45/8h47).
select cron.schedule('alerte-fraicheur-banque', '49 8 * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/alerte-fraicheur-banque',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb
  )
  $cron$
);
