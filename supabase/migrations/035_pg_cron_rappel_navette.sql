-- Migration 035 : pg_cron rappel navette paie — 28 de chaque mois à 9h
--
-- Envoie un email à Oihan le 28 de chaque mois pour lui rappeler
-- d'envoyer la navette paie à Compact (anne@compact.fr).
-- Action : dcb-compta → Auto-Entrepreneurs → onglet "Heures staff" → bouton Navette Compact
--
-- AVANT D'EXÉCUTER :
--   Remplacer __SERVICE_ROLE_KEY__ par la clé service_role depuis :
--   Supabase Dashboard → Project Settings → API → service_role (secret)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Supprimer le job s'il existe déjà (idempotent)
SELECT cron.unschedule('rappel-navette-paie')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'rappel-navette-paie'
);

-- Programmer le rappel le 28 de chaque mois à 9h UTC (11h heure Paris en été)
SELECT cron.schedule(
  'rappel-navette-paie',
  '0 9 28 * *',
  $$
  SELECT net.http_post(
    url     := 'https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/smtp-send',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer __SERVICE_ROLE_KEY__"}'::jsonb,
    body    := jsonb_build_object(
      'to',      'oihan@destinationcotebasque.com',
      'subject', '📋 Rappel — Navette paie à envoyer à Compact',
      'html',    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">'
              || '<div style="background:#EAE3D4;border-bottom:2px solid #CC9933;padding:14px 20px;border-radius:8px 8px 0 0">'
              || '<h2 style="margin:0;font-size:17px;color:#2C2416">📋 Navette paie — fin de mois</h2>'
              || '</div>'
              || '<div style="background:#fff;padding:20px;border:1px solid #D9CEB8;border-top:none;border-radius:0 0 8px 8px">'
              || '<p style="margin-top:0">C''est bientôt la fin du mois. Pense à envoyer la navette paie à <strong>Compact</strong>.</p>'
              || '<ol style="padding-left:20px;line-height:1.8">'
              || '<li>Ouvre <strong>dcb-compta</strong> → <em>Auto-Entrepreneurs</em></li>'
              || '<li>Onglet <strong>⏱ Heures staff</strong></li>'
              || '<li>Sélectionne <strong>Clémence</strong> + le mois en cours</li>'
              || '<li>Clique sur <strong>📤 Navette Compact</strong></li>'
              || '</ol>'
              || '<p style="font-size:12px;color:#8C7B65;margin-bottom:0">Destinataire : anne@compact.fr · Cabinet Compact</p>'
              || '</div>'
              || '</div>'
    )
  ) AS request_id;
  $$
);

-- Vérification
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
