-- 522 — Suivi de la 🎓 Mission d'entraînement du portail AE (21/10/2026, demande d'Oïhan).
-- Une ligne par AE : où il en est dans la formation (parcours complet), quelles étapes et quels thèmes il a vus,
-- début, dernière activité, fin, nombre de sessions. Affichée dans PowerHouse › 👔 Staff (carte + fiche + récapitulatif).
--
-- Sécurité :
--   • lecture : l'AE lit SA ligne seulement ; le staff PowerHouse (auth_user_is_staff) lit tout ;
--   • écriture : AUCUNE écriture directe (pas de politique insert/update/delete) ; seule la RPC formation_progression_maj
--     écrit, et toujours sur la ligne du compte connecté (ae_id déduit de auth.uid(), jamais passé par le client).
--   • c'est la SEULE sortie réseau autorisée pendant la formation (portail : src/formation/garde.js, voie envoyerProgression).

create table if not exists public.formation_progression (
  ae_id uuid primary key references public.auto_entrepreneur(id) on delete cascade,
  version text not null,
  nb_etapes integer not null check (nb_etapes between 1 and 500),
  etape_id text,
  etape_index integer not null default 0 check (etape_index >= 0),   -- reprise du parcours complet (0 = début)
  etape_max integer not null default 0 check (etape_max >= 0),       -- étape la plus loin atteinte dans le parcours complet
  etapes_vues text[] not null default '{}',
  etapes_passees text[] not null default '{}',                        -- « fais-le toi-même » passées sans toucher
  themes_vus text[] not null default '{}',
  themes_catalogue jsonb not null default '[]'::jsonb,                -- [{cle, nom, n}] tels que définis dans etapes.js
  demarree_le timestamptz not null default now(),
  derniere_activite_le timestamptz not null default now(),
  terminee_le timestamptz,
  nb_sessions integer not null default 1,
  derniere_session uuid,
  updated_at timestamptz not null default now()
);

comment on table public.formation_progression is 'Mission d''entraînement du portail AE : progression par AE (migration 522). Écriture via RPC formation_progression_maj seulement.';

alter table public.formation_progression enable row level security;

drop policy if exists formation_progression_lecture on public.formation_progression;
create policy formation_progression_lecture on public.formation_progression
  for select to authenticated
  using (
    ae_id in (select a.id from public.auto_entrepreneur a where a.ae_user_id = auth.uid())
    or public.auth_user_is_staff()
  );

revoke all on public.formation_progression from public, anon;
grant select on public.formation_progression to authenticated;
grant all on public.formation_progression to service_role;

-- Mise à jour idempotente (rejouable hors ligne) : la dernière position gagne si elle est plus récente,
-- les ensembles (étapes, thèmes) s'additionnent, les sessions se comptent par identifiant de session.
create or replace function public.formation_progression_maj(
  p_version text,
  p_nb_etapes integer,
  p_etape_id text,
  p_etape_index integer,
  p_etapes_vues text[] default '{}',
  p_etapes_passees text[] default '{}',
  p_themes_vus text[] default '{}',
  p_themes_catalogue jsonb default null,
  p_terminee boolean default false,
  p_session uuid default null,
  p_quand timestamptz default null,
  p_demarree_le timestamptz default null
)
returns public.formation_progression
language plpgsql volatile security definer
set search_path to 'public'
as $$
declare
  v_ae uuid;
  v_quand timestamptz := least(now(), greatest(coalesce(p_quand, now()), now() - interval '60 days'));
  v_debut timestamptz := least(v_quand, greatest(coalesce(p_demarree_le, v_quand), now() - interval '60 days'));
  v_nb integer := greatest(1, least(coalesce(p_nb_etapes, 1), 500));
  v_idx integer := greatest(0, least(coalesce(p_etape_index, 0), v_nb - 1));
  v_vues text[] := array(select distinct left(x, 60) from unnest(coalesce(p_etapes_vues, '{}')) x where x is not null limit 300);
  v_passees text[] := array(select distinct left(x, 60) from unnest(coalesce(p_etapes_passees, '{}')) x where x is not null limit 300);
  v_themes text[] := array(select distinct left(x, 60) from unnest(coalesce(p_themes_vus, '{}')) x where x is not null limit 100);
  v_cat jsonb := case when jsonb_typeof(p_themes_catalogue) = 'array' and length(p_themes_catalogue::text) < 8000 then p_themes_catalogue end;
  r public.formation_progression;
begin
  select a.id into v_ae from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif order by a.created_at limit 1;
  if v_ae is null then raise exception 'Compte AE introuvable' using errcode = '42501'; end if;

  insert into formation_progression as f (ae_id, version, nb_etapes, etape_id, etape_index, etape_max, etapes_vues, etapes_passees,
    themes_vus, themes_catalogue, demarree_le, derniere_activite_le, terminee_le, nb_sessions, derniere_session)
  values (v_ae, left(coalesce(p_version, '?'), 40), v_nb, left(p_etape_id, 60), v_idx, v_idx, v_vues, v_passees,
    v_themes, coalesce(v_cat, '[]'::jsonb), v_debut, v_quand, case when p_terminee then v_quand end, 1, p_session)
  on conflict (ae_id) do update set
    version = excluded.version,
    nb_etapes = excluded.nb_etapes,
    etape_id = case when v_quand >= f.derniere_activite_le then excluded.etape_id else f.etape_id end,
    etape_index = case when v_quand >= f.derniere_activite_le then excluded.etape_index else f.etape_index end,
    etape_max = greatest(f.etape_max, excluded.etape_max),
    etapes_vues = array(select distinct x from unnest(f.etapes_vues || excluded.etapes_vues) x),
    etapes_passees = array(select distinct x from unnest(f.etapes_passees || excluded.etapes_passees) x),
    themes_vus = array(select distinct x from unnest(f.themes_vus || excluded.themes_vus) x),
    themes_catalogue = coalesce(v_cat, f.themes_catalogue),
    demarree_le = least(f.demarree_le, excluded.demarree_le),
    derniere_activite_le = greatest(f.derniere_activite_le, excluded.derniere_activite_le),
    terminee_le = coalesce(f.terminee_le, excluded.terminee_le),
    nb_sessions = f.nb_sessions + case when p_session is not null and f.derniere_session is distinct from p_session then 1 else 0 end,
    derniere_session = coalesce(p_session, f.derniere_session),
    updated_at = now()
  returning * into r;
  return r;
end $$;

revoke all on function public.formation_progression_maj(text, integer, text, integer, text[], text[], text[], jsonb, boolean, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.formation_progression_maj(text, integer, text, integer, text[], text[], text[], jsonb, boolean, uuid, timestamptz, timestamptz) to authenticated, service_role;
