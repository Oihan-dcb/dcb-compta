-- 488 — Ménage de lancement des périodes confirmées par le propriétaire (19/10/2026, décision Oïhan : pas d'ouverture
-- automatique dans Hospitable, « je veux rester maître et organiser les ménages de lancement »).
-- Une période « louable » qui démarre après une période fermée (début de saison, fin de bail) demande un ménage de
-- lancement avant la 1re nuit ouverte. Planifié = mission du bien (manual_missions ou mission_menage) dans les 7 jours qui
-- précèdent la 1re nuit (détecté, rien n'est créé automatiquement) ; sinon le bureau peut le marquer « pas nécessaire ».
-- La tâche « Ouvrir dans Hospitable » (Accueil › À faire) ne se clôt que si ouvert dans Hospitable ET ménage planifié / pas nécessaire.
alter table public.dispo_proprio_periode add column if not exists menage_lancement_statut text check (menage_lancement_statut in ('pas_necessaire'));
alter table public.dispo_proprio_periode add column if not exists menage_lancement_le timestamptz;
alter table public.dispo_proprio_periode add column if not exists menage_lancement_par text;
comment on column public.dispo_proprio_periode.menage_lancement_statut is
  'pas_necessaire = le bureau a jugé le ménage de lancement inutile (488). NULL = à planifier si la période démarre après une période fermée (détection des missions par dcb-planning api/_dispoProprio.js).';
