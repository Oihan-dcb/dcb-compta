-- 396 — « Valider la durée » depuis le hub des tâches et la vue Aujourd'hui (10/10/2026, demande Oïhan :
-- M-MAITE 10/10, ménage de fond d'Esteban, prévu 1 h, chrono 2 h 15, durée pas déclarée).
--
-- La PAIE (mission_menage + prestation_hors_forfait) est écrite par le code partagé de Gestion › Missions AE
-- (PowerHouse 71-gestion-missions-view.jsx, gmValiderDuree : même calcul que « ⚡ Dépass. », même verrou de
-- clôture, mêmes droits RLS du bureau). Cette RPC fait le reste, côté terrain :
--   • mission_terrain.duree_declaree_minutes = durée retenue par le bureau (si une session Ma journée existe),
--     duree_appliquee_at posée → l'AE n'a plus à déclarer ; la vidéo n'est PAS touchée (reste attendue, ou
--     « Fait sans vidéo » au choix du bureau) ;
--   • mission_journal 'duree_validee' (avant/après, auteur) — lisible dans l'Historique du hub.
-- Bureau seulement (auth_user_is_bureau) : c'est une décision de paie.
create or replace function public.terrain_valider_duree_bureau(p_mission_id uuid, p_retenue_min int, p_extra_min int default 0,
                                                               p_mode text default 'forfait', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m mission_menage; t mission_terrain; v_txt text; v_avant jsonb;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  select * into m from mission_menage where id = p_mission_id;
  if m.id is null then raise exception 'mission_introuvable'; end if;
  if p_retenue_min is null or p_retenue_min < 5 or p_retenue_min > 16 * 60 then raise exception 'duree_invalide'; end if;
  if coalesce(p_extra_min, 0) < 0 or coalesce(p_extra_min, 0) > p_retenue_min then raise exception 'extra_invalide'; end if;
  select * into t from mission_terrain where mission_id = m.id;
  v_avant := jsonb_build_object('duree_declaree_minutes', t.duree_declaree_minutes, 'chrono_min', t.duree_minutes,
                                'duree_heures', m.duree_heures, 'statut', m.statut);
  if t.mission_id is not null then
    update mission_terrain set
      duree_declaree_minutes = p_retenue_min,
      duree_appliquee_at = coalesce(duree_appliquee_at, now()),
      updated_at = now()
    where mission_id = m.id;
  end if;
  v_txt := case when p_mode = 'maintenance'
                then 'Durée confirmée par le bureau : ' || p_retenue_min || ' min (payée au réel)'
                else 'Durée validée par le bureau : ' || p_retenue_min || ' min'
                     || case when coalesce(p_extra_min, 0) > 0 then ' dont ' || p_extra_min || ' min de dépassement en extra' else '' end end
           || coalesce(' — ' || nullif(trim(p_note), ''), '');
  insert into mission_journal (mission_id, bien_id, type, avant, apres, texte, auteur_id, auteur_nom)
  values (m.id, m.bien_id, 'duree_validee', v_avant,
          jsonb_build_object('retenue_min', p_retenue_min, 'extra_min', coalesce(p_extra_min, 0), 'mode', p_mode),
          v_txt, auth.uid(), _nom_auth_user(auth.uid()));
  return jsonb_build_object('ok', true, 'terrain', t.mission_id is not null, 'texte', v_txt);
end $function$;

revoke all on function public.terrain_valider_duree_bureau(uuid, int, int, text, text) from public, anon;
grant execute on function public.terrain_valider_duree_bureau(uuid, int, int, text, text) to authenticated, service_role;
