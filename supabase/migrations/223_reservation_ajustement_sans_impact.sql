-- Migration 223 : ajoute le type 'aucun' aux ajustements Hospitable qualifiables.
--
-- Cas fréquent : résa annulée/remboursée à 100% (Cancellation refund) — l'ajustement
-- Hospitable existe dans la donnée brute mais fin_revenue=0, donc aucun impact réel sur
-- HON/FMEN (la résa n'est même pas ventilée). Forcer un choix hébergement/ménage n'a pas
-- de sens ici — 'aucun' permet de marquer l'ajustement comme traité sans toucher au calcul.

alter table public.reservation_ajustement drop constraint reservation_ajustement_type_check;
alter table public.reservation_ajustement add constraint reservation_ajustement_type_check
  check (type in ('hebergement', 'menage', 'aucun'));
