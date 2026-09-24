-- Migration 267 : contrôle automatique NOCTURNE des virements sortants propriétaires (I-152)
--
-- verify-virements-sortants (livré le 06/09/2026) n'était appelé qu'à l'ouverture de PageFactures :
-- les reversements de juillet-août n'avaient jamais été contrôlés. Désormais chaque nuit, pour les
-- 2 agences, mois M-1 (reversements partis début M) et M-2 (reversements tardifs), après les
-- imports Pennylane (03:50-03:55) et le rapprochement (04:00).
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT * FROM (VALUES
      ('verify-virements-sortants-dcb-m-1',    '10 4 * * *', 'dcb',    -1),
      ('verify-virements-sortants-dcb-m-2',    '13 4 * * *', 'dcb',    -2),
      ('verify-virements-sortants-lauian-m-1', '16 4 * * *', 'lauian', -1),
      ('verify-virements-sortants-lauian-m-2', '19 4 * * *', 'lauian', -2)
    ) AS t(nom, horaire, agence, decalage)
  LOOP
    PERFORM cron.schedule(j.nom, j.horaire, format($cmd$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/verify-virements-sortants',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')),
    body    := jsonb_build_object('agence', %L, 'mois', to_char(now() + interval '%s month', 'YYYY-MM')),
    timeout_milliseconds := 120000
  );
  $cmd$, j.agence, j.decalage));
  END LOOP;
END $$;
