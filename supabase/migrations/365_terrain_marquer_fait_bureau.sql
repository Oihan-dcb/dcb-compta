-- 365 — Le bureau marque « fait » une mission jamais démarrée dans Ma journée (10/10/2026, Oïhan : « ajoute un bouton
-- pour que je puisse marquer fait des missions comme le CI de MIRAMARVEL hier »). PowerHouse → 📍 Terrain → ⚡ Agir →
-- ✅ Contrôle → « Marquer fait ». Crée/complète mission_terrain (terminée, durée = durée prévue, sans vidéo avec
-- motif, contrôlée OK par le bureau, durée appliquée) : la mission ne reste plus « ⏸ non démarrée » et n'est plus
-- relancée. Bureau uniquement. N'écrit RIEN dans la paie (mission_menage inchangé : validation dans Gestion).
create or replace function public.terrain_marquer_fait_bureau(p_mission_id uuid, p_note text default null)
 returns mission_terrain language plpgsql security definer set search_path to 'public' as $function$
declare m mission_menage; t mission_terrain; v_debut timestamptz; v_min int; v_type text; v_motif text;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  select * into m from mission_menage where id = p_mission_id;
  if m.id is null then raise exception 'mission_introuvable'; end if;
  v_min := greatest(5, round(coalesce(m.duree_prevue, 0.5) * 60)::int);
  v_debut := ((m.date_mission::text || ' ' || coalesce(left(m.heure_mission::text, 5), '12:00'))::timestamp at time zone 'Europe/Paris');
  v_type := case m.type_mission when 'checkin' then 'check_in' when 'check_in' then 'check_in' else 'menage' end;
  v_motif := 'Marqué fait par le bureau' || coalesce(' — ' || nullif(trim(p_note), ''), '');
  insert into mission_terrain (mission_id, ae_id, bien_id, statut, started_at, ended_at, type_terrain, start_declare, declare_motif,
                               video_absente_motif, duree_declaree_minutes, duree_appliquee_at, controle_statut, controle_note, controle_par, controle_at)
  values (m.id, m.ae_id, m.bien_id, 'terminee', v_debut, v_debut + make_interval(mins => v_min), v_type, false, v_motif,
          v_motif, v_min, now(), 'ok', v_motif, auth.uid(), now())
  on conflict (mission_id) do update set
    statut = 'terminee',
    ended_at = coalesce(mission_terrain.ended_at, excluded.ended_at),
    video_absente_motif = case when mission_terrain.video_media_id is null then coalesce(mission_terrain.video_absente_motif, excluded.video_absente_motif) else mission_terrain.video_absente_motif end,
    duree_declaree_minutes = coalesce(mission_terrain.duree_declaree_minutes, excluded.duree_declaree_minutes),
    duree_appliquee_at = coalesce(mission_terrain.duree_appliquee_at, now()),
    controle_statut = 'ok', controle_note = excluded.controle_note, controle_par = auth.uid(), controle_at = now(), updated_at = now()
  returning * into t;
  return t;
end $function$;
revoke all on function public.terrain_marquer_fait_bureau(uuid, text) from public, anon;
grant execute on function public.terrain_marquer_fait_bureau(uuid, text) to authenticated;
