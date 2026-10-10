-- 382 — Hub des tâches : états d'une mission passée sans Ma journée (10/10/2026, suite 380-381)
--   • mission déjà VALIDÉE pour la paie sans session Ma journée (avant le 06/10 ou validée à la main) →
--     « bouclée » (cellule Démarrée = pas besoin) au lieu de « acceptée » ;
--   • accueil hors circuit paie (Laura Lauïan / Léa Bordeaux) passé sans Ma journée → état « hors_paie ».

create or replace view public.mission_hub_v with (security_invoker = true) as
with
r as (select * from public.mission_verif_reglage where id = 1),
base as (
  select
    m.id as mission_id, m.ical_uid, m.bien_id, m.ae_id, m.date_mission, m.heure_mission, m.statut as mission_statut,
    m.type_mission, m.titre_ical, m.duree_prevue, m.reservation_id,
    b.code as bien_code, b.hospitable_name as bien_nom, b.agence, b.secteur,
    a.prenom as ae_prenom, a.nom as ae_nom, a.ae_user_id,
    public.mission_debut(m.date_mission, m.heure_mission) as debut,
    case when m.ical_uid ~* '@smartbnb\.io$' then split_part(m.ical_uid, '@', 1) end as task_id,
    'ical_' || left(regexp_replace(coalesce(m.ical_uid, ''), '[^a-zA-Z0-9]', '', 'g'), 40) as event_id,
    round(coalesce(m.duree_prevue, 0) * 60)::int as prevu_min,
    ma.statut as acc_statut, ma.echeance_bureau, ma.refus_motif, ma.refus_precision, ma.traite_le as refus_traite_le,
    ma.notif_ae_le, ma.rappel_ae_le, ma.source as acc_source,
    t.statut as t_statut, t.started_at, t.ended_at, t.type_terrain, t.video_media_id, t.video_absente_motif,
    t.duree_declaree_minutes, coalesce(t.duree_corrigee_minutes, t.duree_minutes) as mesure_min,
    t.controle_statut, t.controle_note, t.controle_at, t.start_geo_statut, t.start_lat, t.fin_oubliee, t.start_declare,
    t.etat_arrivee,
    coalesce(t.declare_motif, '') like 'Marqué fait par le bureau%' as par_bureau,
    (select count(*) from public.tech_issues x where x.mission_id = m.id and x.status = 'signale')::int as nb_tech,
    (select count(*) from public.signalements x where x.mission_id = m.id and x.status = 'ouvert')::int as nb_sig,
    (select count(*) from public.tech_issues x where x.mission_id = m.id)::int
      + (select count(*) from public.signalements x where x.mission_id = m.id)::int as nb_signales,
    (select count(*) from public.besoin_sac x where x.mission_source_id = m.id and x.statut in ('a_preparer', 'dans_sac'))::int as nb_besoins,
    (select count(*) from public.prestation_hors_forfait x where x.mission_id = m.id and x.statut = 'en_attente')::int as nb_extras,
    (select max(j.created_at) from public.mission_journal j where j.mission_id = m.id and j.type = 'relance') as derniere_relance,
    exists (select 1 from public.mission_journal j where j.mission_id = m.id and j.type = 'boucle_non_faite') as non_faite,
    h.assignment_status as hosp_statut, h.teammate_nom as hosp_teammate
  from public.mission_menage m
  left join public.bien b on b.id = m.bien_id
  left join public.auto_entrepreneur a on a.id = m.ae_id
  left join public.mission_acceptation ma on ma.mission_id = m.id and ma.ae_id = m.ae_id
  left join public.mission_terrain t on t.mission_id = m.id
  left join public.hospitable_tache h on h.task_id = case when m.ical_uid ~* '@smartbnb\.io$' then split_part(m.ical_uid, '@', 1) end
  where m.date_mission >= (now() at time zone 'Europe/Paris')::date - 62
    and coalesce(m.statut, '') not in ('cancelled', 'refuse')
),
calc as (
  select base.*,
    (now() at time zone 'Europe/Paris')::date as aujourdhui,
    (base.t_statut = 'terminee' and not base.par_bureau) as terminee_ae,
    -- anomalies (seulement une mission terminée dans Ma journée, pas marquée faite par le bureau)
    array_remove(array[
      case when r.si_depassement and base.prevu_min > 0 and base.mesure_min is not null and not coalesce(base.fin_oubliee, false)
                and base.mesure_min > base.prevu_min * (1 + r.depassement_pct / 100.0) and base.mesure_min - base.prevu_min >= 10
           then base.mesure_min || ' min pour ' || base.prevu_min || ' prévues (+' || round(100.0 * (base.mesure_min - base.prevu_min) / base.prevu_min) || ' %)' end,
      case when r.si_ecart_declare and base.duree_declaree_minutes is not null and base.mesure_min is not null and not coalesce(base.fin_oubliee, false)
                and abs(base.duree_declaree_minutes - base.mesure_min) > r.ecart_declare_min
           then base.duree_declaree_minutes || ' min déclarées, ' || base.mesure_min || ' au chrono' end,
      case when r.si_sans_video and base.video_media_id is null
           then 'pas de vidéo' || coalesce(' (' || case when length(base.video_absente_motif) > 60 then left(base.video_absente_motif, 57) || '…' else base.video_absente_motif end || ')', '') end,
      case when r.si_probleme and (base.nb_signales > 0 or base.etat_arrivee = 'probleme')
           then case when base.nb_signales > 0 then base.nb_signales || ' problème' || case when base.nb_signales > 1 then 's' else '' end || ' signalé' || case when base.nb_signales > 1 then 's' else '' end
                     else 'logement pas en état à l''arrivée' end end,
      case when r.si_position and base.start_lat is null and coalesce(base.start_geo_statut, '') <> 'ok'
           then case when base.start_geo_statut = 'refusee' then 'position refusée par l''AE' else 'position non relevée' end end,
      case when r.si_fin_oubliee and coalesce(base.fin_oubliee, false) then '« Terminer » oublié, durée déclarée après coup' end,
      case when r.si_fin_oubliee and coalesce(base.start_declare, false) then 'démarrage déclaré après oubli' end
    ], null) as anomalies,
    (base.ae_id = any(r.toujours_ae) or base.bien_id = any(r.toujours_biens)) as toujours,
    (r.echantillon_actif and ((hashtext(base.mission_id::text)::bigint % 100) + 100) % 100 < r.echantillon_pct) as tiree,
    least(
      coalesce(base.ended_at, base.debut) + make_interval(hours => r.delai_h),
      ((date_trunc('month', base.date_mission)::date + interval '1 month')::date + (r.jour_limite - 1) + time '23:59')::timestamp at time zone 'Europe/Paris'
    ) as verif_echeance,
    r.boucler_depuis,
    -- accueils jamais payants (Laura sur Lauïan, Léa sur Bordeaux…) : hors circuit paie
    (coalesce(base.type_mission = 'checkin' or base.type_terrain = 'check_in', false) and exists (
       select 1 from jsonb_array_elements(r.accueil_hors_paie) x
        where (x->>'ae_id')::uuid = base.ae_id
          and (x->>'agence' is null or x->>'agence' = base.agence)
          and (x->>'secteur' is null or x->>'secteur' = base.secteur))) as hors_paie
  from base cross join r
),
etat as (
  select calc.*,
    (calc.terminee_ae and not calc.hors_paie and (cardinality(calc.anomalies) > 0 or calc.toujours or calc.tiree)) as a_verifier,
    (calc.acc_statut = 'en_attente' and calc.echeance_bureau <= now()) as acc_en_retard,
    (calc.t_statut is null and not calc.hors_paie and coalesce(calc.mission_statut, '') <> 'valide' and not calc.non_faite
       and calc.date_mission >= calc.boucler_depuis
       and calc.debut + make_interval(mins => greatest(calc.prevu_min, 30)) + interval '2 hours' < now()) as jamais_demarree
  from calc
)
select
  'mission'::text as source,
  e.mission_id, e.task_id, e.event_id, e.bien_id, e.bien_code, e.bien_nom, e.agence, e.secteur,
  e.ae_id, e.ae_prenom, e.ae_nom, e.date_mission, e.heure_mission, e.debut, e.prevu_min,
  coalesce(e.type_terrain,
    case e.type_mission when 'checkout' then 'menage' when 'checkin' then 'check_in' when 'recouche' then 'recouche' else 'technique' end) as type,
  e.mission_statut, e.acc_statut, e.echeance_bureau, e.acc_en_retard, e.refus_motif,
  e.t_statut, e.started_at, e.ended_at, e.mesure_min, e.duree_declaree_minutes, e.video_media_id, e.video_absente_motif,
  e.controle_statut, e.controle_note, e.controle_at, e.fin_oubliee, e.par_bureau,
  e.nb_tech, e.nb_sig, e.nb_besoins, e.nb_extras, e.derniere_relance, e.non_faite,
  e.hosp_statut, e.hosp_teammate,
  e.anomalies, e.toujours, e.tiree, e.a_verifier, case when e.hors_paie then null else e.verif_echeance end as verif_echeance,
  -- les 5 cellules : f fait · c en attente · k bloque · v vérifiée · x pas besoin · '' à venir
  array[
    'f',
    case when e.acc_statut = 'refusee' then 'k' when e.acc_statut = 'en_attente' then case when e.acc_en_retard then 'k' else 'c' end else 'f' end,
    case when e.t_statut = 'en_cours' then 'c' when e.t_statut is not null then 'f'
         when e.non_faite or e.jamais_demarree then 'k'
         when e.debut < now() and (coalesce(e.mission_statut, '') = 'valide' or e.hors_paie) then 'x' else '' end,
    case when e.t_statut = 'video_attendue' then case when e.date_mission < e.aujourdhui then 'k' else 'c' end
         when e.t_statut = 'terminee' then case when e.video_media_id is not null then 'f' else 'x' end else '' end,
    case when e.controle_statut = 'ok' then 'v' when e.controle_statut = 'a_reprendre' then 'k'
         when e.t_statut = 'terminee' then case when e.a_verifier then 'c' else 'x' end else '' end
  ] as etapes,
  case
    when e.acc_statut = 'refusee' then 'refusee'
    when e.non_faite then 'non_faite'
    when e.t_statut is null and e.date_mission < e.aujourdhui and coalesce(e.mission_statut, '') = 'valide' then 'bouclee'
    when e.t_statut is null and e.hors_paie and e.debut < now() then 'hors_paie'
    when e.controle_statut = 'ok' then 'verifiee'
    when e.controle_statut = 'a_reprendre' then 'a_reprendre'
    when e.t_statut = 'terminee' then case when e.a_verifier then 'a_verifier' else 'bouclee' end
    when e.t_statut = 'video_attendue' then 'video_attendue'
    when e.t_statut = 'en_cours' then 'en_cours'
    when e.jamais_demarree then 'jamais_demarree'
    when e.acc_statut = 'en_attente' then 'en_attente'
    else 'acceptee'
  end as etat,
  case
    when e.acc_statut = 'refusee' and e.refus_traite_le is null and e.date_mission >= e.aujourdhui then 'trouver_ae'
    -- en attente : seulement à l'approche de l'échéance (48 h avant), sinon la carte Semaine suffit
    when e.acc_statut = 'en_attente' and e.date_mission >= e.aujourdhui and e.echeance_bureau <= now() + interval '48 hours' then 'relancer'
    when e.t_statut in ('en_cours', 'video_attendue') and (e.date_mission < e.aujourdhui or coalesce(e.fin_oubliee, false)) then 'relancer'
    when e.t_statut = 'video_attendue' and e.ended_at < now() - interval '2 hours' then 'relancer'
    when e.jamais_demarree then 'boucler'
    when e.t_statut = 'terminee' and e.controle_statut is null and e.a_verifier then 'verifier'
  end as groupe,
  case
    when e.acc_statut = 'refusee' then coalesce(e.ae_prenom, 'L''AE') || ' a refusé' || coalesce(' (' || case e.refus_motif when 'indisponible' then 'indisponible' when 'horaire' then 'horaire' when 'trop_loin' then 'trop loin' when 'hospitable' then 'dans l''appli Hospitable' else e.refus_motif end || ')', '')
    when e.acc_statut = 'en_attente' and e.date_mission >= e.aujourdhui then
      case when e.acc_en_retard then 'Toujours pas acceptée, la réponse était attendue le ' || to_char(e.echeance_bureau at time zone 'Europe/Paris', 'DD/MM à HH24:MI')
           else 'Pas encore acceptée, réponse attendue avant le ' || to_char(e.echeance_bureau at time zone 'Europe/Paris', 'DD/MM à HH24:MI') end
    when e.t_statut = 'en_cours' and e.date_mission < e.aujourdhui then 'Démarrée le ' || to_char(e.started_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ', « Terminer » jamais appuyé : il manque la durée et la vidéo'
    when e.t_statut = 'video_attendue' and coalesce(e.fin_oubliee, false) then '« Terminer » oublié puis déclaré : il manque la vidéo'
    when e.t_statut = 'video_attendue' then 'Terminée le ' || to_char(e.ended_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ', vidéo pas encore envoyée'
    when e.jamais_demarree then 'Jamais démarrée dans Ma journée. A-t-elle eu lieu ?'
    when e.t_statut = 'terminee' and e.controle_statut is null and e.a_verifier then
      case when cardinality(e.anomalies) > 0 then upper(left(array_to_string(e.anomalies, ', '), 1)) || substr(array_to_string(e.anomalies, ', '), 2)
           when e.toujours then 'Toujours vérifiée (AE ou bien suivi de près), rien d''anormal'
           else 'Tirée au hasard, rien d''anormal' end
  end as pourquoi,
  e.hors_paie
from etat e

union all

-- Tâches Hospitable sans mission PowerHouse : non assignées, refusées dans l'appli, ou assignées à
-- quelqu'un dont l'iCal n'a pas encore produit la mission.
select
  'hospitable'::text, null::uuid, h.task_id, 'ical_' || left(regexp_replace(h.task_id || '@smartbnb.io', '[^a-zA-Z0-9]', '', 'g'), 40),
  h.bien_id, b.code, b.hospitable_name, b.agence, b.secteur,
  h.ae_id, coalesce(a.prenom, split_part(h.teammate_nom, ' ', 1)), a.nom,
  (h.debut at time zone 'Europe/Paris')::date, (h.debut at time zone 'Europe/Paris')::time, h.debut,
  round(coalesce(h.duree_h, extract(epoch from (h.fin - h.debut)) / 3600.0, 0) * 60)::int,
  coalesce(h.type_ph, 'menage'),
  null, null, null, false, null,
  null, null, null, null, null, null, null,
  null, null, null, null, false,
  0, 0, 0, 0, null, false,
  h.assignment_status, h.teammate_nom,
  '{}'::text[], false, false, false, null,
  array[case when h.teammate_id is null or h.assignment_status in ('rejected', 'unassigned') then 'k' else 'f' end,
        case when h.assignment_status = 'accepted' then 'f' when h.assignment_status = 'pending' then 'c' else '' end, '', '', ''],
  case when h.teammate_id is null or h.assignment_status = 'unassigned' then 'a_attribuer'
       when h.assignment_status = 'rejected' then 'refusee' else 'en_attente' end,
  case when (h.teammate_id is null or h.assignment_status in ('rejected', 'unassigned')) and h.debut >= now() then 'trouver_ae' end,
  case when h.teammate_id is null or h.assignment_status = 'unassigned' then 'Personne n''est sur la mission dans Hospitable'
       when h.assignment_status = 'rejected' then coalesce(split_part(h.teammate_nom, ' ', 1), 'L''AE') || ' a refusé dans l''appli Hospitable'
       else 'Assignée à ' || coalesce(h.teammate_nom, '?') || ' dans Hospitable, pas encore dans son agenda PowerHouse' end,
  false
from public.hospitable_tache h
left join public.bien b on b.id = h.bien_id
left join public.auto_entrepreneur a on a.id = h.ae_id
where h.disparu_le is null
  and coalesce(h.assignment_status, '') <> 'cancelled'
  and h.debut >= now() - interval '62 days'
  and not exists (select 1 from public.mission_menage m where m.ical_uid = h.task_id || '@smartbnb.io' and coalesce(m.statut, '') not in ('cancelled', 'refuse'));

revoke all on public.mission_hub_v from anon, authenticated;
grant select on public.mission_hub_v to service_role;
