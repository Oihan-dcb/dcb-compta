-- 558 — Extra « 📸 Photos pour le guide d'arrivée » : « Fait » refusé tant qu'une photo demandée manque (23/10/2026).
-- Cas d'origine : Xane, PANTXIKA (Maison Maïté) 22/10 — extra coché Fait sans photo déposée, les 2 bonnes photos
-- envoyées dans la conversation à la place (rangées dans la mission par le bureau le 23/10).
-- Même fonction qu'avant (extra_prevu_fait), seul ajout : le contrôle « photos_manquantes ».
create or replace function public.extra_prevu_fait(p_id uuid, p_duree_min integer, p_commentaire text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  x mission_extra_prevu; m mission_menage; t mission_terrain; a auto_entrepreneur; pt prestation_type;
  v_code text; v_duree int; v_taux int; v_montant int; v_presta uuid; v_desc text;
begin
  select * into x from mission_extra_prevu where id = p_id for update;
  if not found then raise exception 'extra_introuvable'; end if;
  m := _terrain_mission_check(x.mission_id);
  if x.statut <> 'prevu' then raise exception 'extra_deja_traite'; end if;
  -- Photos du guide : chaque photo demandée doit avoir au moins une photo déposée dans la mission
  if x.genre = 'photos_arrivee' and exists (
       select 1 from jsonb_array_elements(coalesce(x.photos_demandees, '[]'::jsonb)) d
        where not exists (select 1 from mission_extra_prevu_photo f
                           where f.mission_id = x.mission_id and f.demande_cle = d->>'cle' and f.supprimee_le is null)) then
    raise exception 'photos_manquantes';
  end if;
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null or t.ended_at is not null then raise exception 'mission_pas_en_cours'; end if;
  v_duree := round(coalesce(p_duree_min, 0) / 5.0) * 5;
  if v_duree < 5 or v_duree > 960 then raise exception 'duree_invalide'; end if;
  select * into a from auto_entrepreneur where id = m.ae_id;
  select * into pt from prestation_type where id = x.prestation_type_id;
  select code into v_code from bien where id = m.bien_id;
  v_taux := case when v_code = '01' then 2000 else coalesce(a.taux_horaire, 2500) end;
  v_montant := case when pt.unite = 'forfait' then coalesce(pt.taux_defaut, v_taux) else round(v_duree / 60.0 * v_taux) end;
  v_desc := 'Extra prévu par le bureau : ' || x.libelle || case when nullif(trim(p_commentaire), '') is not null then ' — ' || left(trim(p_commentaire), 300) else '' end;
  insert into prestation_hors_forfait (ae_id, mission_id, prestation_type_id, bien_id, date_prestation, duree_minutes, montant,
                                       type_imputation, description, statut, mois, reservation_id)
  values (m.ae_id, m.id, x.prestation_type_id, m.bien_id, m.date_mission, case when pt.unite = 'forfait' then null else v_duree end, v_montant,
          x.type_imputation, v_desc, 'en_attente', m.mois, null)
  returning id into v_presta;
  update mission_extra_prevu set statut = 'fait', prestation_id = v_presta, duree_reelle_minutes = v_duree, fait_le = now(), fait_par_ae_id = m.ae_id,
         commentaire_apres = coalesce(nullif(trim(p_commentaire), ''), commentaire_apres), updated_at = now()
   where id = x.id;
  return jsonb_build_object('prestation_id', v_presta, 'duree_minutes', v_duree, 'montant', v_montant);
end $function$;
