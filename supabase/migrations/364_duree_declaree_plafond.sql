-- 364 — Temps déclaré par le staff plafonné à la durée de la mission sauf justification (10/10/2026, Oïhan :
-- « Esteban doit déclarer 45 min pas 1 h — s'il déclare plus il doit le justifier »). Cas PANTXIKA : déclaré 1 h,
-- chrono 55 min, prévu 45 min, aucun extra. La paie était déjà plafonnée (règle forfait 05/10), mais le temps
-- déclaré restait affiché à 1 h. Portail : tout dépassement demande un extra, sinon « Rien de particulier »
-- ramène le temps déclaré à la durée prévue. Serveur (garde-fou) : à la confirmation d'un ménage, le temps
-- déclaré est ramené à durée prévue + extras déclarés pendant la mission ; la valeur saisie est gardée dans
-- duree_declaree_brute (visible au bureau).
alter table public.mission_terrain add column if not exists duree_declaree_brute integer;
comment on column public.mission_terrain.duree_declaree_brute is 'Temps saisi par le staff avant plafonnement à durée prévue + extras (migration 364).';

create or replace function public.terrain_marquer_duree_appliquee(p_mission_id uuid)
 returns mission_terrain language plpgsql security definer set search_path to 'public' as $function$
declare t mission_terrain; m mission_menage; v_extras int; v_max int;
begin
  perform _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = p_mission_id;
  select * into m from mission_menage where id = p_mission_id;
  if t.mission_id is not null and t.duree_appliquee_at is null and coalesce(t.type_terrain, 'menage') = 'menage'
     and m.duree_prevue is not null and t.duree_declaree_minutes is not null then
    select coalesce(sum(p.duree_minutes), 0) into v_extras from prestation_hors_forfait p
     where p.mission_id = p_mission_id and coalesce(p.statut, '') not in ('annule', 'refuse')
       and (t.started_at is null or p.created_at >= t.started_at);
    v_max := round(m.duree_prevue * 60)::int + v_extras;
    if t.duree_declaree_minutes > v_max then
      update mission_terrain set duree_declaree_brute = t.duree_declaree_minutes, duree_declaree_minutes = v_max, updated_at = now()
       where mission_id = p_mission_id;
    end if;
  end if;
  update mission_terrain set duree_appliquee_at = coalesce(duree_appliquee_at, now()), updated_at = now()
   where mission_id = p_mission_id and ended_at is not null
  returning * into t;
  if not found then raise exception 'mission_non_terminee'; end if;
  return t;
end $function$;
