-- 305 — Rattachement des signalements terrain à leur mission (05/10/2026).
-- Depuis « Ma journée » (portail AE), un problème technique ou un signalement voyageur est créé
-- pré-rempli depuis la mission en cours : on garde le lien pour PowerHouse (qui, quand, quel séjour).
alter table public.tech_issues add column if not exists mission_id uuid references public.mission_menage(id) on delete set null;
alter table public.signalements add column if not exists mission_id uuid references public.mission_menage(id) on delete set null;
create index if not exists tech_issues_mission_idx on public.tech_issues (mission_id) where mission_id is not null;
create index if not exists signalements_mission_idx on public.signalements (mission_id) where mission_id is not null;
