-- 379 — Hub des tâches terrain, Lot 0 : statuts jamais fermés, corrigés à la cause (Oïhan 10/10/2026)
--
-- 1) RECOUCHE reconnue comme type de mission (mission_menage.type_mission = 'recouche').
--    Hospitable n'a pas de type « recouche » : elle arrive en tâche « Maintenance » avec une note
--    (« ménage de recouche sans changement de linge »). sync-ical-ae lit désormais la note de l'iCal
--    (DESCRIPTION « Notes: … ») et pose 'recouche'. Ma journée la pré-sélectionne.
--
-- 2) manual_missions.status / deleted figés : le Planning écrit le statut réel dans mission_state
--    (pending → inprogress → done / deleted) et ne touchait JAMAIS manual_missions.status, resté
--    « pending » à vie (91 missions passées « pending » dont 16 faites et 34 supprimées). Conséquences :
--    l'iCal RDV des AE (api/ical-rdv.js, filtre deleted=false) exportait des missions supprimées, et
--    l'analyse planning (api/analyze-planning.js, status=done) ne trouvait jamais rien.
--    → trigger : mission_state devient la seule saisie, manual_missions suit. Rattrapage = recopie du
--      statut de mission_state (source affichée dans le Planning), aucune autre donnée touchée.
--
-- 3) Chrono resté ouvert toute la nuit (PANORAMA 09/10 : « Terminer » appuyé le lendemain 09:20 →
--    chrono 1 355 min) : terrain_terminer acceptait une fin le lendemain. Désormais, au-delà de 12 h
--    ou d'un changement de jour, la fin n'est plus horodatée « maintenant » : l'AE indique l'heure
--    réelle de fin (terrain_terminer_oubli) avec un motif, le début réel (chrono) est conservé, et la
--    session est marquée fin_oubliee (à contrôler). Rattrapage : seul le marqueur fin_oubliee est posé
--    sur les sessions déjà dans ce cas (règle identique) ; aucune durée ni paie modifiée.

-- ─── 1. Recouche ─────────────────────────────────────────────────────────────────────────────────
alter table public.mission_menage drop constraint if exists mission_menage_type_mission_check;
alter table public.mission_menage add constraint mission_menage_type_mission_check
  check (type_mission = any (array['checkout', 'checkin', 'fond', 'autre', 'recouche']));

-- ─── 2. manual_missions suit mission_state ──────────────────────────────────────────────────────
create or replace function public._manual_missions_suivre_etat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.status, '') = '' then return new; end if;
  if new.status = 'deleted' then
    update manual_missions set deleted = true where id = new.mission_id and not deleted;
  else
    update manual_missions set status = new.status
     where id = new.mission_id and status is distinct from new.status;
  end if;
  return new;
end $$;
revoke all on function public._manual_missions_suivre_etat() from public, anon, authenticated;

drop trigger if exists trg_manual_missions_suivre_etat on public.mission_state;
create trigger trg_manual_missions_suivre_etat
  after insert or update of status on public.mission_state
  for each row execute function public._manual_missions_suivre_etat();

-- Rattrapage (conséquence directe du trigger, même règle)
update public.manual_missions mm set deleted = true
  from public.mission_state ms
 where ms.mission_id = mm.id and ms.status = 'deleted' and not mm.deleted;
update public.manual_missions mm set status = ms.status
  from public.mission_state ms
 where ms.mission_id = mm.id and coalesce(ms.status, '') not in ('', 'deleted')
   and mm.status is distinct from ms.status;

-- ─── 3. Fin de mission oubliée ───────────────────────────────────────────────────────────────────
alter table public.mission_terrain add column if not exists fin_oubliee boolean not null default false;
alter table public.mission_terrain add column if not exists fin_motif text;
comment on column public.mission_terrain.fin_oubliee is
  '« Terminer » pas appuyé à temps (> 12 h ou jour suivant) : heure de fin déclarée par l''AE (fin_motif), chrono non fiable → à contrôler. Migration 379.';

-- Fin « hors délai » : démarrée un autre jour (heure de Paris) ou depuis plus de 12 h.
create or replace function public._terrain_fin_hors_delai(p_started timestamptz, p_fin timestamptz)
returns boolean language sql stable as $$
  select p_fin - p_started > interval '12 hours'
      or (p_started at time zone 'Europe/Paris')::date <> (p_fin at time zone 'Europe/Paris')::date
$$;

create or replace function public.terrain_terminer(p_mission_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_acc double precision DEFAULT NULL::double precision, p_geo_statut text DEFAULT NULL::text)
 RETURNS mission_terrain
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t mission_terrain; b bien;
begin
  perform _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = p_mission_id for update;
  if not found then raise exception 'mission_non_demarree'; end if;
  if t.ended_at is not null then return t; end if;
  -- 379 : plus de fin horodatée le lendemain (chrono de 22 h) → l'AE indique son heure de fin réelle
  if _terrain_fin_hors_delai(t.started_at, now()) then raise exception 'fin_a_declarer'; end if;
  select * into b from bien where id = t.bien_id;
  update mission_terrain set
    ended_at = now(),
    end_lat = p_lat, end_lng = p_lng, end_acc_m = p_acc,
    end_distance_m = distance_m(p_lat, p_lng, b.geo_lat, b.geo_lng),
    end_geo_statut = _terrain_geo_statut(p_lat, p_geo_statut),
    duree_minutes = greatest(5, (round(extract(epoch from (now() - started_at)) / 60 / 5) * 5)::int),
    statut = case when video_media_id is not null then 'terminee' else 'video_attendue' end,
    updated_at = now()
  where mission_id = p_mission_id
  returning * into t;
  return t;
end $function$;

-- L'AE a oublié « Terminer » : elle indique l'heure réelle de fin (après le début, au plus 16 h après,
-- pas dans le futur) et un motif. Le début (chrono serveur) n'est pas modifié.
create or replace function public.terrain_terminer_oubli(p_mission_id uuid, p_fin timestamptz, p_motif text)
returns public.mission_terrain
language plpgsql security definer set search_path = public as $$
declare t mission_terrain;
begin
  perform _terrain_mission_check(p_mission_id);
  if length(trim(coalesce(p_motif, ''))) < 3 then raise exception 'motif_obligatoire'; end if;
  select * into t from mission_terrain where mission_id = p_mission_id for update;
  if not found then raise exception 'mission_non_demarree'; end if;
  if t.ended_at is not null then return t; end if;
  if p_fin is null or p_fin <= t.started_at + interval '5 minutes' or p_fin > now()
     or p_fin > t.started_at + interval '16 hours' then raise exception 'heure_fin_invalide'; end if;
  update mission_terrain set
    ended_at = p_fin,
    end_geo_statut = 'ignoree',
    duree_minutes = greatest(5, (round(extract(epoch from (p_fin - started_at)) / 60 / 5) * 5)::int),
    fin_oubliee = true, fin_motif = trim(p_motif),
    statut = case when video_media_id is not null then 'terminee' else 'video_attendue' end,
    updated_at = now()
  where mission_id = p_mission_id
  returning * into t;
  return t;
end $$;
revoke all on function public.terrain_terminer_oubli(uuid, timestamptz, text) from public, anon;
grant execute on function public.terrain_terminer_oubli(uuid, timestamptz, text) to authenticated;

-- Rattrapage : marqueur seul (même règle), pour que le bureau ne lise pas le chrono comme une durée.
update public.mission_terrain
   set fin_oubliee = true,
       fin_motif = coalesce(fin_motif, '« Terminer » appuyé hors délai (avant le correctif du 10/10/2026) — chrono non fiable')
 where ended_at is not null and not fin_oubliee and _terrain_fin_hors_delai(started_at, ended_at);
