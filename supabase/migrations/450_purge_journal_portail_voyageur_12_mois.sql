-- 450 — Portail voyageur : journal des consultations et des vérifications conservé 12 mois, puis supprimé
-- automatiquement (décision d'Oïhan 16/10/2026, annoncé dans la politique de confidentialité).
-- Chaque nuit à 03h45 UTC (à côté de purge-direct-evenement 03h40) :
--   • portail_voyageur_consultation (pages vues : réseau tronqué /24 ou /48, type d'appareil, langue) ;
--   • portail_voyageur_evenement (codes envoyés / réussis / ratés, blocages, appareils reconnus, consultations sensibles) ;
--   • portail_voyageur_code (empreintes HMAC des codes, cible masquée) ;
--   • portail_voyageur_session (appareils reconnus) dont l'expiration ou la révocation date de plus de 12 mois.
-- Les liens, commandes d'options, signalements et messages ne sont PAS concernés (règles propres).
select cron.unschedule('purge-portail-voyageur-journal') where exists (select 1 from cron.job where jobname = 'purge-portail-voyageur-journal');
select cron.schedule('purge-portail-voyageur-journal', '45 3 * * *', $$
  delete from public.portail_voyageur_consultation where le < now() - interval '12 months';
  delete from public.portail_voyageur_evenement where le < now() - interval '12 months';
  delete from public.portail_voyageur_code where cree_le < now() - interval '12 months';
  delete from public.portail_voyageur_session where least(coalesce(revoque_le, expire_le), expire_le) < now() - interval '12 months';
$$);
comment on table public.portail_voyageur_consultation is 'Portail voyageur (442) : journal des consultations, sans IP complète (IPv4 /24, IPv6 /48). Purge automatique à 12 mois (450, cron purge-portail-voyageur-journal).';
comment on table public.portail_voyageur_evenement is 'Portail voyageur (448) : journal des vérifications (code envoyé/affiché, réussi, raté, blocage), sessions, accompagnants, accès coupé, consultations de données sensibles. Sans IP complète. Purge automatique à 12 mois (450).';
