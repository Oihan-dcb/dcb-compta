-- 322 — Oublis de démarrage, régularisation, rappels et conformité (05/10/2026, décisions Oïhan)
-- Objectif : que les AE suivent le workflow Ma journée sans que le bureau corrige tout le temps.
--  - « J'ai oublié de démarrer » : l'AE déclare l'heure réelle d'arrivée (bornée) → start_declare=true,
--    visible du bureau ; le plafond au forfait s'applique toujours.
--  - Régularisation d'une mission jamais démarrée : début + fin déclarés + motif ; vidéo si possible,
--    sinon « pas de vidéo » motivé (video_absente_motif) → décision bureau.
--  - Mission ménage SANS passage par Ma journée (à partir du 06/10/2026) = BLOQUÉE (pas d'auto-
--    validation de paie) tant qu'elle n'est pas régularisée ; le bureau tranche en dernier recours.
--  - Saisie manuelle des heures = exception avec motif (mission_menage.saisie_manuelle_motif), jamais
--    auto-validée.
--  - terrain_rappel : rappels push envoyés (dédoublonnage), cron dcb-planning cron-terrain-rappels.
alter table public.mission_terrain add column if not exists start_declare boolean not null default false;
alter table public.mission_terrain add column if not exists declare_motif text;
alter table public.mission_terrain add column if not exists video_absente_motif text;
alter table public.mission_menage add column if not exists saisie_manuelle_motif text;

create table if not exists public.terrain_rappel (
  mission_id uuid not null references public.mission_menage(id) on delete cascade,
  type       text not null check (type in ('demarrage', 'soir')),
  envoye_at  timestamptz not null default now(),
  primary key (mission_id, type)
);
alter table public.terrain_rappel enable row level security;
drop policy if exists terrain_rappel_select on public.terrain_rappel;
create policy terrain_rappel_select on public.terrain_rappel for select to authenticated using (auth_user_is_staff() or auth_user_is_bureau());

-- Déclaration d'un oubli : p_fin null = démarrage déclaré (mission en cours) ; p_fin = régularisation complète.
create or replace function public.terrain_declarer(p_mission_id uuid, p_debut timestamptz, p_fin timestamptz, p_motif text, p_type text default 'menage')
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; prevu timestamptz;
begin
  m := _terrain_mission_check(p_mission_id);
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  if p_debut is null or p_debut > now() then raise exception 'heure_debut_invalide'; end if;
  prevu := ((m.date_mission + coalesce(m.heure_mission, '09:00'::time)) at time zone 'Europe/Paris');
  if p_debut < prevu - interval '3 hours' or p_debut > prevu + interval '14 hours' then raise exception 'heure_debut_hors_journee'; end if;
  if p_fin is not null and (p_fin <= p_debut or p_fin > now() or p_fin > p_debut + interval '16 hours') then raise exception 'heure_fin_invalide'; end if;
  select * into t from mission_terrain where mission_id = m.id;
  if found and t.ended_at is not null then raise exception 'mission_deja_terminee'; end if;
  if found then
    update mission_terrain set started_at = p_debut, start_declare = true, declare_motif = trim(p_motif), updated_at = now()
     where mission_id = m.id;
  else
    insert into mission_terrain (mission_id, ae_id, bien_id, started_at, start_declare, declare_motif, type_terrain, etat_arrivee)
    values (m.id, m.ae_id, m.bien_id, p_debut, true, trim(p_motif), coalesce(p_type, 'menage'), case when p_fin is not null then 'ok' end);
  end if;
  if p_fin is not null then
    update mission_terrain set ended_at = p_fin,
      duree_minutes = greatest(5, (round(extract(epoch from (p_fin - p_debut)) / 60 / 5) * 5)::int),
      statut = case when video_media_id is not null then 'terminee' else 'video_attendue' end, updated_at = now()
     where mission_id = m.id;
  end if;
  select * into t from mission_terrain where mission_id = m.id;
  return t;
end $$;
revoke all on function public.terrain_declarer(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.terrain_declarer(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- Pas de vidéo possible (régularisation après coup) : motif obligatoire, la mission se boucle, le bureau décide.
create or replace function public.terrain_sans_video(p_mission_id uuid, p_motif text)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  update mission_terrain set video_absente_motif = trim(p_motif), statut = 'terminee', updated_at = now()
   where mission_id = p_mission_id and ended_at is not null and start_declare and video_media_id is null
  returning * into t;
  if not found then raise exception 'non_autorise'; end if;
  return t;
end $$;
revoke all on function public.terrain_sans_video(uuid, text) from public, anon;
grant execute on function public.terrain_sans_video(uuid, text) to authenticated;

-- Conformité par AE (PowerHouse → Staff) depuis le lancement du workflow.
create or replace function public.stats_conformite_terrain(p_depuis date default '2026-10-06')
returns table (ae_id uuid, nb_missions integer, nb_terrain integer, nb_video integer, nb_declares integer, nb_manuelles integer)
language sql stable security definer set search_path = public as $$
  select m.ae_id, count(*)::int,
    count(t.mission_id)::int,
    count(t.video_media_id)::int,
    count(*) filter (where t.start_declare)::int,
    count(*) filter (where m.saisie_manuelle_motif is not null)::int
  from mission_menage m left join mission_terrain t on t.mission_id = m.id
  where m.date_mission >= p_depuis and m.date_mission <= current_date
    and m.statut not in ('cancelled', 'refuse') and coalesce(m.titre_ical, '') not like 'Maintenance%'
    and (auth_user_is_bureau() or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))))
  group by m.ae_id;
$$;
revoke all on function public.stats_conformite_terrain(date) from public, anon;
grant execute on function public.stats_conformite_terrain(date) to authenticated;
