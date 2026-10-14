-- 412 — Alerte bureau « ménage pas démarré avant l'arrivée » (14/10/2026, demande d'Oïhan).
-- Incident 416 du 13/10/2026 : ménage prévu 12h15 jamais démarré, rappel « Démarrer » parti à l'AE seul
-- (13h15), voyageurs arrivés à 16h dans un logement sale → réservation annulée (509,56 €). Le bureau n'avait
-- rien reçu alors qu'il restait près de 3 h pour envoyer quelqu'un.
-- Désormais (PowerHouse api/cron-terrain-rappels.js) : ménage du jour PAS DÉMARRÉ 2h30 avant l'arrivée des
-- voyageurs du jour sur le même bien → push urgent aux managers du bien (salon manager_group). Une seule fois
-- par mission : type 'bureau_arrivee' dans terrain_rappel. Le Point du matin du lendemain reprend ces cas
-- (source alerte_etat 'menage_en_retard_arrivee', close d'elle-même le jour suivant).

alter table public.terrain_rappel drop constraint if exists terrain_rappel_type_check;
alter table public.terrain_rappel add constraint terrain_rappel_type_check
  check (type in ('demarrage', 'soir', 'bureau_arrivee'));
