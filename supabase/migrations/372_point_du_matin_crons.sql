-- Migration 372 : Point du matin — planification (audit des mails 09/10/2026)
--
-- 1. Les contrôles compta ne mailent plus : ils publient dans alerte_etat. Ils passent de 08:05-08:49 UTC
--    (10h Paris, APRÈS le Point du matin) à 04:05-04:49 UTC (06h/05h Paris) pour que le Point du matin de
--    08:00 Paris lise l'état de la nuit. Même ordre, même écart de 2 min DCB/Lauïan.
-- 2. point-du-matin : 06:00 et 07:00 UTC ; la fonction ne travaille qu'à 08:00 heure de Paris
--    (heure d'été UTC+2 → 06:00 UTC ; heure d'hiver UTC+1 → 07:00 UTC), l'autre passage est ignoré,
--    et point_du_matin_envoi empêche tout second envoi le même jour.
-- 3. sync-evoliz-statut (07:55 / 07:57 UTC) → 04:55 / 04:57 UTC (avant le Point du matin).
-- 4. rappel-navette-paie (job 29) postait {"type":"rappel_navette"} à smtp-send, sans destinataire ni sujet
--    → 400 à chaque fois, rappel jamais reçu. Il appelle désormais auto-navette-mensuelle {mode:'rappel'},
--    qui écrit au rôle 'paie' seulement s'il reste des navettes à faire à la main.

DO $$
DECLARE
  r record;
  v_url text := '(select decrypted_secret from vault.decrypted_secrets where name = ''SUPABASE_URL'')';
  v_auth text := '''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''SUPABASE_SERVICE_ROLE_KEY'')';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('alerte-solde-manuel-dcb', '5 4 * * *'), ('alerte-solde-manuel-lauian', '7 4 * * *'),
    ('alerte-solde-booking-platform-dcb', '9 4 * * *'), ('alerte-solde-booking-platform-lauian', '11 4 * * *'),
    ('alerte-virement-orphelin-dcb', '13 4 * * *'), ('alerte-virement-orphelin-lauian', '15 4 * * *'),
    ('alerte-encaissement-proprio-incoherent-dcb', '17 4 * * *'), ('alerte-encaissement-proprio-incoherent-lauian', '19 4 * * *'),
    ('alerte-mission-menage-orpheline-dcb', '21 4 * * *'), ('alerte-mission-menage-orpheline-lauian', '23 4 * * *'),
    ('alerte-prestation-doublon-dcb', '25 4 * * *'), ('alerte-prestation-doublon-lauian', '27 4 * * *'),
    ('alerte-sejour-sans-menage-dcb', '29 4 * * *'), ('alerte-sejour-sans-menage-lauian', '31 4 * * *'),
    ('alerte-changement-post-facture-dcb', '45 4 * * *'), ('alerte-changement-post-facture-lauian', '47 4 * * *'),
    ('alerte-fraicheur-banque', '49 4 * * *'),
    ('sync-evoliz-statut-dcb', '55 4 * * *'), ('sync-evoliz-statut-lauian', '57 4 * * *')
  ) AS t(jobname, sched) LOOP
    PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = r.jobname), schedule := r.sched);
  END LOOP;

  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('point-du-matin-06utc', 'point-du-matin-07utc');
  PERFORM cron.schedule('point-du-matin-06utc', '0 6 * * *', format($f$
    select net.http_post(url := %s || '/functions/v1/point-du-matin',
      headers := jsonb_build_object('Content-Type','application/json','Authorization', %s),
      body := '{}'::jsonb, timeout_milliseconds := 120000) $f$, v_url, v_auth));
  PERFORM cron.schedule('point-du-matin-07utc', '0 7 * * *', format($f$
    select net.http_post(url := %s || '/functions/v1/point-du-matin',
      headers := jsonb_build_object('Content-Type','application/json','Authorization', %s),
      body := '{}'::jsonb, timeout_milliseconds := 120000) $f$, v_url, v_auth));

  PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'rappel-navette-paie'), command := format($f$
    select net.http_post(url := %s || '/functions/v1/auto-navette-mensuelle',
      headers := jsonb_build_object('Content-Type','application/json','Authorization', %s),
      body := '{"mode":"rappel"}'::jsonb, timeout_milliseconds := 60000) $f$, v_url, v_auth));
END $$;
