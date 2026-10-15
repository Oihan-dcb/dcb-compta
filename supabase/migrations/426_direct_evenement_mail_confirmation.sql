-- 426 — Vente directe : journal de l'envoi du mail de confirmation de réservation (15/10/2026).
-- api/_directConfirmation.envoyerApresConversion (dcb-planning) journalise chaque envoi réel dans direct_evenement
-- (type « mail_confirmation »). Envoi désactivé tant que DIRECT_MAIL_CONFIRMATION ≠ « actif » et qu'aucun bien n'est publié.
alter table direct_evenement drop constraint if exists direct_evenement_type_check;
alter table direct_evenement add constraint direct_evenement_type_check
  check (type = any (array['vue','devis','reservation','demande','refus','abus','essai','mail_confirmation']));
