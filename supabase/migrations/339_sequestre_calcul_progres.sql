-- 339 — Progression du recalcul du justificatif séquestre (07/10/2026) : le bouton « Recalculer
-- maintenant » lance le calcul côté serveur (api/sequestre-justificatif) qui écrit ici son avancement ;
-- la page le lit toutes les secondes pour afficher une barre de progression. Écriture : service role.
create table if not exists public.sequestre_calcul_progres (
  agence text primary key,
  pct integer not null default 0,
  etape text,
  auteur text,
  debut timestamptz,
  maj timestamptz not null default now(),
  termine boolean not null default false,
  erreur text
);
alter table public.sequestre_calcul_progres enable row level security;
drop policy if exists sequestre_calcul_progres_bureau on public.sequestre_calcul_progres;
create policy sequestre_calcul_progres_bureau on public.sequestre_calcul_progres
  for select to authenticated using (public.auth_user_is_bureau());
