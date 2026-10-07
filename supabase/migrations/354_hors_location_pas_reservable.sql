-- 354 — Oïhan 08/10/2026 : « ou alors il faut juste un filtre dans le planning où on décoche la vision et ça
-- reste… si on prend une résa au moins on a les messages ». Recommandation retenue : RÉACTIVER les biens dans
-- Hospitable (réservations, messages, synchro) et les masquer chez nous. Pour que la réactivation ne les fasse
-- pas réapparaître, les biens aujourd'hui masqués du seul fait de la sourdine deviennent un masquage MANUEL
-- (motif « pas_reservable »), réversible depuis la fiche du bien (PowerHouse).
alter table public.bien drop constraint if exists bien_hors_location_motif_check;
alter table public.bien add constraint bien_hors_location_motif_check
  check (hors_location_motif in ('etudiant_hors_dcb', 'proprio_occupe', 'bloque', 'plus_gere', 'pas_reservable', 'autre'));
update public.bien set hors_location = true, hors_location_motif = 'pas_reservable'
 where listed and not hors_location and statut_location = 'hors_location' and hospitable_etat = 'muted';
