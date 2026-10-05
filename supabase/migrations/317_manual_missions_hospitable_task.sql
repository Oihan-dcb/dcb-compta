-- 317 — Missions PowerHouse créées aussi dans Hospitable (05/10/2026, demande Oïhan)
-- Une mission manuelle PowerHouse rattachée à un bien crée une tâche Hospitable (Maintenance, assignée
-- au teammate de l'AE par email) via dcb-planning api/hospitable-task-create.js ; ses modifications
-- (date, heure, durée, AE, note, suppression) suivent. La tâche revient par l'iCal de l'AE
-- (planning_events.id = 'ical_' || task_id sans tirets || 'smartbnb') → masquée au rendu PowerHouse
-- pour éviter le doublon ; côté AE elle devient une mission_menage normale (Ma journée).
alter table public.manual_missions add column if not exists hospitable_task_id text;
alter table public.manual_missions add column if not exists hospitable_sync_error text;
create index if not exists manual_missions_hosp_task_idx on public.manual_missions (hospitable_task_id) where hospitable_task_id is not null;
