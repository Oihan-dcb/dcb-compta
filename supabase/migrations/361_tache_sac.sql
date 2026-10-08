-- 361 — Sac de linge d'une tâche : où est le sac (zone_sac) et où le déposer après la mission (zone_depot)
-- (08/10/2026, Oïhan : « j'ai mis les sacs à MM mais ça n'apparaît nulle part dans daily team, daily recap ;
-- en toutes lettres je veux : sac à : … ; ajoute un bloc où déposer le sac, mêmes réponses que sac de linge ;
-- cette info doit être dans les récaps, dans Ma journée… »).
-- Jusqu'ici la zone ne vivait que dans la note Hospitable de la tâche (api/_linenZone.js) et n'était lue que
-- par l'écran Sacs & tâches. Table chez nous (cap autonomie Hospitable) : écrite par dcb-planning
-- api/hospitable-task-note (en plus de la note), resynchronisée depuis les notes par api/hospitable-tasks ;
-- lue par les récaps (push du matin, Daily recap / Daily team, Ma journée) via mission_menage.ical_uid
-- = task_id || '@smartbnb.io'.
create table if not exists public.tache_sac (
  task_id text primary key,
  zone_sac text,
  zone_depot text,
  sac_fait boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.tache_sac is 'Sac de linge par tâche Hospitable : zone_sac (où est le sac), zone_depot (où le déposer après), sac_fait. Migration 361.';
alter table public.tache_sac enable row level security;
create policy tache_sac_lecture on public.tache_sac for select using (public.auth_user_is_internal());

-- Vue pratique : sac par mission (missions issues des tâches Hospitable)
create or replace view public.mission_sac with (security_invoker = true) as
  select m.id as mission_id, s.zone_sac, s.zone_depot, s.sac_fait
    from public.mission_menage m
    join public.tache_sac s on m.ical_uid = s.task_id || '@smartbnb.io';
comment on view public.mission_sac is 'Sac de linge de chaque mission (via tâche Hospitable). Migration 361.';
grant select on public.mission_sac to authenticated;
