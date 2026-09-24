-- Migration 269 : synchro statuts/montants Evoliz aussi pour Lauïan (audit segment Factures, I-153)
-- Seul sync-evoliz-statut-dcb existait : les factures Lauïan (société Evoliz 115576) n'étaient
-- jamais relues — 28 factures honoraires 'envoye_evoliz' au 24/09/2026, jamais passées 'payee'.
-- 07:57, après le job DCB (07:55), avant les relances (08:00/08:10).
select cron.schedule('sync-evoliz-statut-lauian', '57 7 * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/sync-evoliz-statut',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{"agence":"lauian"}'::jsonb
  )
$cron$);
