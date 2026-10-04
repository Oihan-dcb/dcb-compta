-- 299 — Un seul contrat non annulé par réservation (04/10/2026)
-- generate-contract n'avait aucune déduplication : deux créateurs concurrents (webhook PowerHouse,
-- cron 30 min, et jusqu'au 04/10 le webhook dcb-compta) pouvaient créer deux contrats actifs pour
-- la même résa (cf. doublons Maurer 30/09). Les contrats annulés restent multiples (historique).
create unique index if not exists rental_contracts_un_actif_par_resa
  on public.rental_contracts (reservation_id)
  where statut <> 'cancelled' and reservation_id is not null;
