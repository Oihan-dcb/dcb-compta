-- 407 — Horaires par défaut des biens : 16:00 → 10:00 partout (règle Oïhan 11/10/2026),
-- sauf départ 12:00 à Maison Maïté (M-MAITE).
-- Cause des écarts relevés par l'audit fiche bien (COTREL, ONGI… à 17:00 ; 11 biens à 11:00) :
-- la valeur par défaut de la colonne était '17:00' (et le générateur de contrat retombait aussi
-- sur 17:00). Les biens créés sans horaire héritaient donc d'une arrivée à 17:00 que personne
-- n'applique. On corrige le défaut, puis on aligne les biens sur la règle.
alter table public.bien alter column heure_arrivee_defaut set default '16:00';
alter table public.bien alter column heure_depart_defaut  set default '10:00';

update public.bien set heure_arrivee_defaut = '16:00'
 where heure_arrivee_defaut is distinct from '16:00';
update public.bien set heure_depart_defaut = case when code = 'M-MAITE' then '12:00' else '10:00' end
 where heure_depart_defaut is distinct from (case when code = 'M-MAITE' then '12:00' else '10:00' end);
