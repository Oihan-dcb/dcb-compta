-- 436 — Purge du journal des pages « Réserver » (direct_evenement) au-delà de 12 mois (15/10/2026).
-- Le journal contient une empreinte non réversible de l'IP (HMAC du jour, jamais l'IP en clair) :
-- durée annoncée dans la politique de confidentialité = 12 mois. Les stats du module n'utilisent que 30 jours.
select cron.unschedule('purge-direct-evenement') where exists (select 1 from cron.job where jobname = 'purge-direct-evenement');
select cron.schedule('purge-direct-evenement', '40 3 * * *',
  $$delete from public.direct_evenement where cree_le < now() - interval '12 months'$$);
