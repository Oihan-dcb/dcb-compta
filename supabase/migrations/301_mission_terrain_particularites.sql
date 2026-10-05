-- 301 — Workflow terrain Portail AE (Lot A) — 05/10/2026
--
-- 1. mission_terrain : session terrain d'une mission ménage (début/fin horodatés serveur,
--    position ponctuelle début/fin, vidéo de fin). Table SÉPARÉE de mission_menage : sync-ical-ae
--    réécrit mission_menage (cf. bug juin 2026 statut écrasé) — on n'y recopie que la durée finale.
--    Écritures UNIQUEMENT via les RPC terrain_* (SECURITY DEFINER) : l'AE ne peut pas forger
--    started_at / ended_at (chrono côté serveur, now()).
-- 2. media_library.mission_id : la vidéo « après ménage » rattachée à SA mission.
-- 3. bien_particularite (+ lecture) : fiches « Particularités du bien » (spa, lave-vaisselle…),
--    rattachées à bien.id (identifiant canonique, PAS bien_toolbox.id).

-- ── 1. mission_terrain ─────────────────────────────────────────────────────
create table if not exists public.mission_terrain (
  mission_id             uuid primary key references public.mission_menage(id) on delete restrict,
  ae_id                  uuid not null references public.auto_entrepreneur(id) on delete restrict,
  bien_id                uuid references public.bien(id) on delete restrict,
  statut                 text not null default 'en_cours'
                           check (statut in ('en_cours', 'video_attendue', 'terminee')),
  started_at             timestamptz not null default now(),
  ended_at               timestamptz,
  -- Géolocalisation PONCTUELLE (début/fin seulement, jamais de suivi continu — CNIL).
  start_lat              double precision,
  start_lng              double precision,
  start_acc_m            double precision,
  end_lat                double precision,
  end_lng                double precision,
  end_acc_m              double precision,
  -- État du logement à l'arrivée (« normal ? ») : ok | probleme
  etat_arrivee           text check (etat_arrivee in ('ok', 'probleme')),
  -- Durée mesurée (arrondie 5 min) puis éventuelle correction déclarée par l'AE avec motif.
  duree_minutes          integer,
  duree_corrigee_minutes integer,
  motif_correction       text,
  video_media_id         uuid references public.media_library(id) on delete set null,
  video_at               timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists mission_terrain_ae_idx on public.mission_terrain (ae_id, started_at desc);
create index if not exists mission_terrain_bien_idx on public.mission_terrain (bien_id, started_at desc);

alter table public.mission_terrain enable row level security;

-- Lecture : l'AE propriétaire de la mission, le bureau, les managers (périmètre secteur).
drop policy if exists mission_terrain_select on public.mission_terrain;
create policy mission_terrain_select on public.mission_terrain for select to authenticated using (
  auth_user_is_bureau()
  or auth_user_owns_ae(ae_id)
  or (
    exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.is_chat_manager and a.actif)
    and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))
  )
);
-- Pas de policy INSERT/UPDATE/DELETE : écriture via RPC uniquement.

-- ── 2. media_library.mission_id ────────────────────────────────────────────
alter table public.media_library add column if not exists mission_id uuid references public.mission_menage(id) on delete set null;
create index if not exists media_library_mission_idx on public.media_library (mission_id) where mission_id is not null;

-- ── RPC terrain ────────────────────────────────────────────────────────────
-- Garde commune : la mission doit appartenir à l'appelant et ne pas être annulée/refusée.
create or replace function public._terrain_mission_check(p_mission_id uuid)
returns public.mission_menage
language plpgsql stable security definer set search_path = public as $$
declare m mission_menage;
begin
  select * into m from mission_menage where id = p_mission_id;
  if not found then raise exception 'mission_introuvable'; end if;
  if not auth_user_owns_ae(m.ae_id) then raise exception 'mission_hors_perimetre'; end if;
  if m.statut in ('cancelled', 'refuse') then raise exception 'mission_annulee'; end if;
  return m;
end $$;

-- Démarrer : idempotent (2e appel = renvoie la session existante, ne redémarre PAS le chrono).
create or replace function public.terrain_demarrer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_etat_arrivee text default null
) returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain;
begin
  m := _terrain_mission_check(p_mission_id);
  insert into mission_terrain (mission_id, ae_id, bien_id, start_lat, start_lng, start_acc_m, etat_arrivee)
  values (m.id, m.ae_id, m.bien_id, p_lat, p_lng, p_acc, p_etat_arrivee)
  on conflict (mission_id) do nothing;
  select * into t from mission_terrain where mission_id = m.id;
  return t;
end $$;

-- État du logement à l'arrivée (peut être posé juste après le démarrage).
create or replace function public.terrain_etat_arrivee(p_mission_id uuid, p_etat text)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if p_etat not in ('ok', 'probleme') then raise exception 'etat_invalide'; end if;
  update mission_terrain set etat_arrivee = p_etat, updated_at = now()
   where mission_id = p_mission_id returning * into t;
  if not found then raise exception 'mission_non_demarree'; end if;
  return t;
end $$;

-- Terminer : fige ended_at (serveur) et la durée arrondie aux 5 min. Idempotent.
create or replace function public.terrain_terminer(
  p_mission_id uuid, p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null
) returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = p_mission_id for update;
  if not found then raise exception 'mission_non_demarree'; end if;
  if t.ended_at is not null then return t; end if;
  update mission_terrain set
    ended_at = now(),
    end_lat = p_lat, end_lng = p_lng, end_acc_m = p_acc,
    duree_minutes = greatest(5, (round(extract(epoch from (now() - started_at)) / 60 / 5) * 5)::int),
    statut = case when video_media_id is not null then 'terminee' else 'video_attendue' end,
    updated_at = now()
  where mission_id = p_mission_id
  returning * into t;
  return t;
end $$;

-- Correction de durée déclarée par l'AE (motif obligatoire) — après la fin seulement.
create or replace function public.terrain_corriger_duree(p_mission_id uuid, p_minutes integer, p_motif text)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if p_minutes is null or p_minutes < 5 or p_minutes > 16 * 60 then raise exception 'duree_invalide'; end if;
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  update mission_terrain set
    duree_corrigee_minutes = (round(p_minutes / 5.0) * 5)::int,
    motif_correction = trim(p_motif), updated_at = now()
  where mission_id = p_mission_id and ended_at is not null
  returning * into t;
  if not found then raise exception 'mission_non_terminee'; end if;
  return t;
end $$;

-- Vidéo de fin : le média doit être un « après ménage » du même bien, envoyé par l'appelant.
create or replace function public.terrain_attacher_video(p_mission_id uuid, p_media_id uuid)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; med media_library;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into med from media_library where id = p_media_id;
  if not found then raise exception 'media_introuvable'; end if;
  if med.sender_id <> auth.uid() or med.subject <> 'apres_menage' or med.bien_id is distinct from m.bien_id then
    raise exception 'media_non_conforme';
  end if;
  update media_library set mission_id = m.id where id = p_media_id and mission_id is null;
  update mission_terrain set
    video_media_id = p_media_id, video_at = now(),
    statut = case when ended_at is not null then 'terminee' else statut end,
    updated_at = now()
  where mission_id = m.id
  returning * into t;
  if not found then raise exception 'mission_non_demarree'; end if;
  return t;
end $$;

revoke all on function public._terrain_mission_check(uuid) from public, anon;
revoke all on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.terrain_etat_arrivee(uuid, text) from public, anon;
revoke all on function public.terrain_terminer(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function public.terrain_corriger_duree(uuid, integer, text) from public, anon;
revoke all on function public.terrain_attacher_video(uuid, uuid) from public, anon;
grant execute on function public.terrain_demarrer(uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.terrain_etat_arrivee(uuid, text) to authenticated;
grant execute on function public.terrain_terminer(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.terrain_corriger_duree(uuid, integer, text) to authenticated;
grant execute on function public.terrain_attacher_video(uuid, uuid) to authenticated;

-- ── 3. Particularités du bien ──────────────────────────────────────────────
create table if not exists public.bien_particularite (
  id          uuid primary key default gen_random_uuid(),
  bien_id     uuid not null references public.bien(id) on delete restrict,
  categorie   text not null default 'autre',   -- spa, piscine, lave_vaisselle, lave_linge, chauffage, alarme, acces, exterieur, dechets, autre
  titre       text not null,
  contenu     text,                            -- étapes, une par ligne
  medias      jsonb not null default '[]'::jsonb, -- [{url, is_video}]
  importance  text not null default 'info' check (importance in ('info', 'important', 'critique')),
  ordre       integer not null default 0,
  actif       boolean not null default true,
  created_by  uuid default auth.uid(),
  updated_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bien_particularite_bien_idx on public.bien_particularite (bien_id) where actif;

create table if not exists public.bien_particularite_lecture (
  particularite_id uuid not null references public.bien_particularite(id) on delete cascade,
  ae_id            uuid not null references public.auto_entrepreneur(id) on delete cascade,
  lu_at            timestamptz not null default now(),
  primary key (particularite_id, ae_id)
);

-- Qui peut rédiger les fiches : bureau, ou fiche AE active manager / acces_admin.
create or replace function public.auth_user_peut_editer_fiches()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_user_is_bureau()
      or exists (select 1 from auto_entrepreneur a
                 where a.ae_user_id = auth.uid() and a.actif and (a.is_chat_manager or a.acces_admin));
$$;
revoke all on function public.auth_user_peut_editer_fiches() from public, anon;
grant execute on function public.auth_user_peut_editer_fiches() to authenticated;

alter table public.bien_particularite enable row level security;
alter table public.bien_particularite_lecture enable row level security;

-- Lecture : même périmètre que memo_bien (interne, scopé secteur pour le staff).
drop policy if exists bien_particularite_select on public.bien_particularite;
create policy bien_particularite_select on public.bien_particularite for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff())
);
drop policy if exists bien_particularite_write on public.bien_particularite;
create policy bien_particularite_write on public.bien_particularite for all to authenticated
  using (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

drop policy if exists bien_particularite_lecture_select on public.bien_particularite_lecture;
create policy bien_particularite_lecture_select on public.bien_particularite_lecture for select to authenticated
  using (auth_user_owns_ae(ae_id) or auth_user_peut_editer_fiches());
drop policy if exists bien_particularite_lecture_write on public.bien_particularite_lecture;
create policy bien_particularite_lecture_write on public.bien_particularite_lecture for insert to authenticated
  with check (auth_user_owns_ae(ae_id));
drop policy if exists bien_particularite_lecture_update on public.bien_particularite_lecture;
create policy bien_particularite_lecture_update on public.bien_particularite_lecture for update to authenticated
  using (auth_user_owns_ae(ae_id)) with check (auth_user_owns_ae(ae_id));

-- ── (302) Durée confirmée par l'AE ─────────────────────────────────────────
-- La durée n'est écrite dans mission_menage qu'après confirmation (« C'est bon » / « Corriger ») :
-- une mission auto-validée n'est plus modifiable par l'AE (RLS mission_update), donc écrire
-- avant la confirmation empêcherait toute correction.
alter table public.mission_terrain add column if not exists duree_appliquee_at timestamptz;

create or replace function public.terrain_marquer_duree_appliquee(p_mission_id uuid)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  update mission_terrain set duree_appliquee_at = coalesce(duree_appliquee_at, now()), updated_at = now()
   where mission_id = p_mission_id and ended_at is not null
  returning * into t;
  if not found then raise exception 'mission_non_terminee'; end if;
  return t;
end $$;
revoke all on function public.terrain_marquer_duree_appliquee(uuid) from public, anon;
grant execute on function public.terrain_marquer_duree_appliquee(uuid) to authenticated;
