-- 229 — Relances débours proprio (appliquée en base le 2026-07-05)
-- Relances automatiques des factures débours envoyées par email (cron relance-debours, 8h UTC) :
-- relance 1 à J+5, relance 2 à J+10, escalade push Oïhan à J+15 (nb_relances=3, badge rouge UI).
alter table facture_evoliz add column if not exists envoye_proprio_at timestamptz;
alter table facture_evoliz add column if not exists nb_relances integer not null default 0;
alter table facture_evoliz add column if not exists derniere_relance_at timestamptz;
update facture_evoliz set envoye_proprio_at = updated_at where statut = 'envoye_proprio' and envoye_proprio_at is null;

-- pg_cron (job 35) posé le 2026-07-05 :
-- select cron.schedule('relance-debours-daily', '0 8 * * *', $$ SELECT net.http_post(url := <SUPABASE_URL>/functions/v1/relance-debours, ...) $$);
