-- 352 — État Hospitable de chaque bien (08/10/2026) : contrôle quotidien edge function hospitable-etat-biens
-- (actif / muted / introuvable), étiquettes « En location » / « Étudiant » posées dans Hospitable d'après
-- bien.statut_location (migration 351), alerte mail quand un bien en service devient inaccessible.
alter table public.bien
  add column if not exists hospitable_etat text,
  add column if not exists hospitable_etat_at timestamptz,
  add column if not exists hospitable_tag_a_retirer boolean not null default false;
comment on column public.bien.hospitable_etat is 'actif / muted / introuvable / erreur_xxx — dernier contrôle hospitable-etat-biens. Migration 352.';
comment on column public.bien.hospitable_tag_a_retirer is 'Une étiquette Hospitable (En location / Étudiant) ne correspond plus au statut : à retirer à la main (API ajout seulement). Migration 352.';
select cron.schedule('hospitable-etat-biens', '40 5 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/hospitable-etat-biens',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
