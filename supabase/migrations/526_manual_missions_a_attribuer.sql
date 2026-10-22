-- 526 — Missions « À attribuer » (22/10/2026, demande Oïhan) : une mission manuelle PowerHouse peut être créée
-- SANS staff, puis attribuée plus tard depuis Missions.
-- · manual_missions.staff_id devient facultatif (NULL = à attribuer). Jamais de chaîne vide : la contrainte
--   impose NULL pour « personne », afin que les filtres (staff_id=is.null) soient fiables.
-- · Tâche Hospitable d'une mission sur un bien : créée seulement à la PREMIÈRE attribution (api/hospitable-task-create.js
--   appelé par PowerHouse, manual_missions.hospitable_task_id gardé → pas de doublon aux attributions suivantes).
--   Tant qu'elle n'est pas attribuée, rien n'arrive dans un portail AE (le portail lit mission_menage via l'iCal AE).
-- · Aucun autre objet ne lit manual_missions.staff_id en base (mission_ecarts ne regarde que bien_id/date/status,
--   trigger _manual_missions_suivre_etat que status) ; paie/factures AE passent par mission_menage → non concernées.
alter table public.manual_missions alter column staff_id drop not null;
update public.manual_missions set staff_id = null where staff_id is not null and btrim(staff_id) = '';
alter table public.manual_missions drop constraint if exists manual_missions_staff_id_non_vide;
alter table public.manual_missions add constraint manual_missions_staff_id_non_vide check (staff_id is null or btrim(staff_id) <> '');
create index if not exists manual_missions_a_attribuer_idx on public.manual_missions (date)
  where staff_id is null and not coalesce(deleted, false);
comment on column public.manual_missions.staff_id is 'Staff principal (slug PowerHouse). NULL = mission « À attribuer » (526) : tâche Hospitable créée à la première attribution.';
