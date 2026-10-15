-- 421 — Metrics PowerHouse : onglets Taxes de séjour, Avis, Missions (15/10/2026).
--
-- 1. mission_hub_periode(du, au[, depuis]) : le CORPS de mission_hub_v (382) avec une fenêtre de dates en
--    paramètre ; mission_hub_v devient « select * from mission_hub_periode(aujourd'hui − 62, null, now() − 62 j) »
--    (mêmes colonnes, même résultat, fonction SQL inlinée par le planificateur → même plan). Metrics lit
--    l'historique complet avec les MÊMES règles que le hub (états, anomalies, dépassements) : rien n'est dupliqué.
-- 2. reservation_review : réponse publique de l'hôte (reponse, repondu_le), peut_repondre, plateforme et note
--    d'origine — lus par sync-reviews (GET /properties/{id}/reviews : public.response, responded_at,
--    can_respond, platform, public.rating_platform_original). Lecture seule côté Hospitable.
-- 3. ph_metrics_taxes(début, fin, agence, biens) : données BRUTES de la taxe de séjour (biens + réglages,
--    barèmes, résas, taxe encaissée = lignes TAXE de la ventilation hors « TVA ») ; le calcul est fait par
--    api/metrics.js avec la copie conforme de dcb-compta/src/lib/taxeSejour.js (mêmes règles que la page
--    Taxe de séjour). Biens en gestion offerte INCLUS (la taxe est due quand même), comme la page.
-- 4. ph_metrics_avis(périodes, agence, biens) : avis reçus (date de l'avis, heure de Paris, une note par résa,
--    biens en gestion offerte exclus — même règle que la note de la Vue d'ensemble), répartition, sous-notes,
--    canaux, biens, mois, mots-clés (lexique, sans IA), réponses ; propreté par AE seulement avec le droit équipe.
-- 5. ph_metrics_missions(périodes, agence, biens) : missions de la période lues dans mission_hub_periode +
--    mission_acceptation + prestation_hors_forfait ; coûts AE seulement avec le droit équipe.
-- Droit « équipe » (coûts AE, propreté par AE) = même règle que Gestion › Missions AE dans PowerHouse
-- (canGestion : compte bureau et pas staff_scope) : Oïhan, Laura (sur Lauïan) ; pas Léa. Sans droit perf
-- (Clémence…) : acces_refuse, comme le reste de Metrics.

-- ─── 1. Hub : corps paramétré ─────────────────────────────────────────────────────────────────────
create or replace function public.mission_hub_periode(p_du date, p_au date default null, p_depuis timestamptz default null)
returns table (
  source text, mission_id uuid, task_id text, event_id text, bien_id uuid, bien_code text, bien_nom text, agence text, secteur text,
  ae_id uuid, ae_prenom text, ae_nom text, date_mission date, heure_mission time, debut timestamptz, prevu_min integer, type text,
  mission_statut text, acc_statut text, echeance_bureau timestamptz, acc_en_retard boolean, refus_motif text,
  t_statut text, started_at timestamptz, ended_at timestamptz, mesure_min integer, duree_declaree_minutes integer,
  video_media_id uuid, video_absente_motif text, controle_statut text, controle_note text, controle_at timestamptz,
  fin_oubliee boolean, par_bureau boolean, nb_tech integer, nb_sig integer, nb_besoins integer, nb_extras integer,
  derniere_relance timestamptz, non_faite boolean, hosp_statut text, hosp_teammate text,
  anomalies text[], toujours boolean, tiree boolean, a_verifier boolean, verif_echeance timestamptz,
  etapes text[], etat text, groupe text, pourquoi text, hors_paie boolean
)
language sql stable as $fn$
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
  where m.date_mission >= p_du and (p_au is null or m.date_mission <= p_au)
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
  and h.debut >= coalesce(p_depuis, (p_du::timestamp at time zone 'Europe/Paris'))
  and (p_au is null or (h.debut at time zone 'Europe/Paris')::date <= p_au)
  and not exists (select 1 from public.mission_menage m where m.ical_uid = h.task_id || '@smartbnb.io' and coalesce(m.statut, '') not in ('cancelled', 'refuse'))
$fn$;
comment on function public.mission_hub_periode(date, date, timestamptz) is
  'Corps de mission_hub_v (382) avec fenêtre en paramètre (421). mission_hub_v = fenêtre J-62 ; Metrics = période choisie. Modifier les règles ICI (une seule définition).';
revoke all on function public.mission_hub_periode(date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.mission_hub_periode(date, date, timestamptz) to service_role;

create or replace view public.mission_hub_v with (security_invoker = true) as
  select * from public.mission_hub_periode((now() at time zone 'Europe/Paris')::date - 62, null, now() - interval '62 days');
revoke all on public.mission_hub_v from anon, authenticated;
grant select on public.mission_hub_v to service_role;

-- ─── 2. Avis : réponse de l'hôte, plateforme ──────────────────────────────────────────────────────
alter table public.reservation_review
  add column if not exists reponse text,
  add column if not exists repondu_le timestamptz,
  add column if not exists peut_repondre boolean,
  add column if not exists plateforme text,
  add column if not exists note_origine text;
comment on column public.reservation_review.reponse is 'Réponse publique de l''hôte (Hospitable public.response), lue par sync-reviews (421).';
comment on column public.reservation_review.peut_repondre is 'Hospitable can_respond : la plateforme accepte encore une réponse (421).';

-- ─── Droit « équipe » (coûts AE, propreté par AE) ─────────────────────────────────────────────────
create or replace function public.ph_metrics_droit_equipe()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth_user_is_bureau() and coalesce(auth_user_powerhouse_role(), '') <> 'staff_scope';
$$;
revoke all on function public.ph_metrics_droit_equipe() from public, anon;
grant execute on function public.ph_metrics_droit_equipe() to authenticated;

-- Biens du compte pour un onglet : périmètre ∩ agence ∩ sélection (p_offerts : garder la gestion offerte)
create or replace function public.ph_metrics_biens_onglet(p_agence text, p_biens uuid[], p_offerts boolean)
returns uuid[] language plpgsql stable security definer set search_path to 'public' as $$
declare v uuid[];
begin
  v := ph_metrics_perimetre();  -- acces_refuse sans droit perf
  if p_agence is not null and p_agence not in ('dcb', 'lauian') then raise exception 'agence_invalide'; end if;
  select coalesce(array_agg(b.id), '{}') into v from bien b
   where b.id = any(v) and (p_agence is null or b.agence = p_agence) and (p_biens is null or b.id = any(p_biens))
     and (p_offerts or not coalesce(b.gestion_offerte, false));
  return v;
end $$;
revoke all on function public.ph_metrics_biens_onglet(text, uuid[], boolean) from public, anon, authenticated;

-- ─── 3. Taxes de séjour : données brutes (calcul = taxeSejour.js, dans api/metrics.js) ────────────
create or replace function public.ph_metrics_taxes(p_debut date, p_fin date, p_agence text default null, p_biens uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_biens uuid[];
begin
  v_biens := ph_metrics_biens_onglet(p_agence, p_biens, true);
  if p_debut is null or p_fin is null or p_fin < p_debut or p_fin - p_debut > 731 then raise exception 'periode_invalide'; end if;
  return jsonb_build_object(
    'biens', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'nom', b.hospitable_name, 'ville', b.ville,
                'classification', b.classification, 'classification_date', b.classification_date, 'classification_fin', b.classification_fin,
                'classification_confirmee', b.classification_confirmee, 'agence', b.agence, 'listed', b.listed,
                'gestion_taxe_sejour', b.gestion_taxe_sejour, 'taxe_commune', b.taxe_commune, 'taxe_regime', b.taxe_regime,
                'taxe_collecte', b.taxe_collecte, 'taxe_tarif_saisi', b.taxe_tarif_saisi) order by b.code), '[]'::jsonb)
                from bien b where b.id = any(v_biens)),
    'configs', (select coalesce(jsonb_agg(jsonb_build_object('commune', c.commune, 'classification', c.classification, 'type_calcul', c.type_calcul,
                'taux_pct', c.taux_pct, 'plafond_ht', c.plafond_ht, 'tarif_pers_nuit', c.tarif_pers_nuit, 'coeff_additionnel', c.coeff_additionnel,
                'annee', c.annee, 'agence', c.agence)), '[]'::jsonb) from taxe_sejour_config c),
    'resas', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'bien_id', r.bien_id, 'code', r.code, 'guest_count', r.guest_count,
                'adultes', r.hospitable_raw->'guests'->>'adult_count', 'taxes_voyageur', r.hospitable_raw->'financials'->'guest'->'taxes',
                'arrival_date', r.arrival_date, 'nights', r.nights, 'fin_accommodation', r.fin_accommodation, 'platform', r.platform,
                'final_status', r.final_status, 'owner_stay', r.owner_stay,
                'encaisse_cts', (select sum(v.montant_ttc) from ventilation v where v.reservation_id = r.id and v.code = 'TAXE'
                                  and coalesce(v.libelle, '') !~* '^tva([^a-z0-9_]|$)'))
                order by r.arrival_date), '[]'::jsonb)
                from reservation r where r.bien_id = any(v_biens) and r.arrival_date between p_debut and p_fin)
  );
end $$;
revoke all on function public.ph_metrics_taxes(date, date, text, uuid[]) from public, anon;
grant execute on function public.ph_metrics_taxes(date, date, text, uuid[]) to authenticated;

-- ─── 4. Avis ──────────────────────────────────────────────────────────────────────────────────────
-- Lexique des mots-clés (FR / EN / ES), sans IA. Motifs compatibles PostgreSQL et JavaScript (insensibles à la casse).
create or replace function public.ph_metrics_avis_lexique()
returns table (cle text, libelle text, sens text, motif text) language sql immutable as $$
  values
    ('propre', 'Propreté', 'pos', '(tr[eè]s propre|impeccable|nickel|spotless|very clean|super clean|immaculate|so clean|muy limpi)'),
    ('emplacement', 'Emplacement', 'pos', '(emplacement|bien situ|id[ée]alement situ|great location|perfect location|good location|excellent location|ubicaci[oó]n)'),
    ('vue', 'Vue', 'pos', '(la vue|vue mer|vue sur|sea view|ocean view|the view|amazing view|vistas)'),
    ('plage', 'Plage à pied', 'pos', '(plage|beach|playa)'),
    ('calme', 'Calme', 'pos', '(calme|quiet|peaceful|tranquil)'),
    ('confort', 'Confort, literie', 'pos', '(confortable|comfortable|comfy|bonne literie|c[oó]mod)'),
    ('equipe', 'Bien équipé', 'pos', '(bien [ée]quip|tout le n[ée]cessaire|well equipped|fully equipped|everything we needed|everything you need|bien equipad)'),
    ('accueil', 'Accueil, réactivité', 'pos', '(accueil|r[ée]acti|chaleureu|responsive|helpful|welcoming|attentive|atent|amabl)'),
    ('deco', 'Charme, déco', 'pos', '(d[ée]co|charm|cosy|cozy|stylish|tasteful|beautifully)'),
    ('sale', 'Saleté', 'neg', '(sale[ .,!]|salet[ée]|pas propre|poussi[eè]re|cheveu|tache|dirty|dust|hairs?[ .,!]|stain|not clean|sucio|polvo)'),
    ('bruit', 'Bruit', 'neg', '(bruit|bruyant|noisy|noise|ruido)'),
    ('odeur', 'Odeur, humidité', 'neg', '(odeur|humidit|moisi|smell|odou?r|musty|mould|mold|olor|humedad)'),
    ('panne', 'Équipement en panne', 'neg', '(cass[ée]|ne fonctionn|en panne|hors service|broken|not working|didn.t work|doesn.t work|roto|no funciona)'),
    ('temperature', 'Chaleur, froid', 'neg', '(trop chaud|chaleur|clim|froid|chauffage|too hot|air con|heating|too cold|calor|fr[ií]o)'),
    ('literie', 'Literie inconfortable', 'neg', '(inconfortable|matelas|uncomfortable|mattress|colch[oó]n)'),
    ('parking', 'Stationnement', 'neg', '(parking|stationnement|se garer|aparcamiento)'),
    ('vetuste', 'Vétusté', 'neg', '(v[ée]tuste|usé|dated|old-fashioned|run down|anticuad)'),
    ('wifi', 'Wi-Fi', 'neg', '(wi-?fi|internet)');
$$;

create or replace function public.ph_metrics_avis_calc(p_biens uuid[], p_debut date, p_fin date, p_equipe boolean, p_liste boolean)
returns jsonb language sql stable security definer set search_path to 'public' as $$
with rv0 as (
  select distinct on (coalesce(rv.reservation_id, rv.id)) rv.id, coalesce(r.bien_id, rv.bien_id) as bien_id, rv.rating::numeric as note,
         rv.detailed_ratings, coalesce(rv.plateforme, r.platform) as plat, rv.comment, rv.private_feedback, rv.reviewer_name,
         rv.submitted_at, (rv.submitted_at at time zone 'Europe/Paris')::date as jour, rv.reponse, rv.repondu_le, rv.peut_repondre, r.code as resa
    from reservation_review rv left join reservation r on r.id = rv.reservation_id
   where rv.rating is not null
     and (rv.submitted_at at time zone 'Europe/Paris')::date between p_debut and p_fin
     and coalesce(r.bien_id, rv.bien_id) = any(p_biens)
   order by coalesce(rv.reservation_id, rv.id), rv.submitted_at desc
),
rv as (
  select rv0.*, case when plat ~* 'airbnb' then 'airbnb' when plat ~* 'booking' then 'booking' when plat ~* '(vrbo|homeaway|abritel)' then 'autre'
                     when plat is null then 'autre' else 'direct' end as canal,
         lower(coalesce(comment, '') || ' ' || coalesce(private_feedback, '')) as txt
    from rv0
),
sous as (
  select rv.id, rv.bien_id, rv.canal, d->>'type' as t, (d->>'rating')::numeric / case when rv.canal = 'booking' then 2 else 1 end as v
    from rv, jsonb_array_elements(case when jsonb_typeof(rv.detailed_ratings) = 'array' then rv.detailed_ratings else '[]'::jsonb end) d
   where (d->>'rating') ~ '^[0-9.]+$' and (d->>'rating')::numeric > 0
),
lex as (select * from ph_metrics_avis_lexique()),
mots as (
  select l.cle, l.libelle, l.sens, l.motif, count(rv.id) as n, count(rv.id) filter (where rv.note <= 3) as n_bas,
         count(rv.id) filter (where rv.note >= 4.5) as n_haut, coalesce(jsonb_agg(rv.id) filter (where rv.id is not null), '[]'::jsonb) as ids
    from lex l left join rv on rv.txt ~* l.motif group by l.cle, l.libelle, l.sens, l.motif
),
b as (select bb.id, bb.code, bb.agence from bien bb where bb.id = any(p_biens))
select jsonb_build_object(
  'totaux', (select jsonb_build_object('n', count(*), 'somme', coalesce(sum(note), 0), 'n_bas', count(*) filter (where note <= 3),
      'n_5', count(*) filter (where note >= 4.75), 'n_comment', count(*) filter (where coalesce(comment, '') <> ''),
      'n_prive', count(*) filter (where coalesce(private_feedback, '') <> ''),
      'n_repondu', count(*) filter (where reponse is not null or repondu_le is not null),
      'n_repondable', count(*) filter (where reponse is not null or repondu_le is not null or peut_repondre),
      'n_reponse_connue', count(*) filter (where peut_repondre is not null or reponse is not null or repondu_le is not null)) from rv),
  'repartition', (select jsonb_object_agg(k, coalesce(n, 0)) from generate_series(1, 5) k
      left join (select least(5, greatest(1, round(note)))::int as e, count(*) n from rv group by 1) x on x.e = k),
  'sous_notes', (select coalesce(jsonb_object_agg(t, jsonb_build_object('n', n, 'moy', moy)), '{}'::jsonb)
      from (select t, count(*) n, avg(v) moy from sous group by t) x),
  'canaux', (select coalesce(jsonb_agg(jsonb_build_object('canal', canal, 'n', n, 'somme', somme, 'n_bas', n_bas,
        'proprete', (select avg(v) from sous s where s.canal = x.canal and s.t = 'cleanliness'))), '[]'::jsonb)
      from (select canal, count(*) n, sum(note) somme, count(*) filter (where note <= 3) n_bas from rv group by canal) x),
  'biens', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'agence', b.agence, 'n', x.n, 'somme', x.somme, 'n_bas', x.n_bas,
        'proprete', (select avg(v) from sous s where s.bien_id = b.id and s.t = 'cleanliness'),
        'communication', (select avg(v) from sous s where s.bien_id = b.id and s.t = 'communication'),
        'emplacement', (select avg(v) from sous s where s.bien_id = b.id and s.t = 'location'),
        'n_repondu', x.n_repondu, 'n_repondable', x.n_repondable) order by b.code), '[]'::jsonb)
      from b join (select bien_id, count(*) n, sum(note) somme, count(*) filter (where note <= 3) n_bas,
                          count(*) filter (where reponse is not null or repondu_le is not null) n_repondu,
                          count(*) filter (where reponse is not null or repondu_le is not null or peut_repondre) n_repondable
                     from rv group by bien_id) x on x.bien_id = b.id),
  'mois', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'somme', somme, 'n_bas', n_bas) order by m), '[]'::jsonb)
      from (select to_char(jour, 'YYYY-MM') m, count(*) n, sum(note) somme, count(*) filter (where note <= 3) n_bas from rv group by 1) x),
  'jours', (select coalesce(jsonb_agg(jsonb_build_array(d::date, coalesce(x.n, 0), coalesce(x.somme, 0)) order by d), '[]'::jsonb)
      from generate_series(p_debut, p_fin, interval '1 day') d left join (select jour, count(*) n, sum(note) somme from rv group by jour) x on x.jour = d::date),
  'mots', (select coalesce(jsonb_agg(jsonb_build_object('cle', cle, 'l', libelle, 'sens', sens, 'motif', motif, 'n', n, 'n_bas', n_bas, 'n_haut', n_haut,
        'ids', case when p_liste then ids else null end) order by sens, n desc), '[]'::jsonb) from mots),
  'avis', case when p_liste then (select coalesce(jsonb_agg(jsonb_build_object('id', rv.id, 'bien', b.code, 'jour', rv.jour, 'canal', rv.canal, 'note', rv.note,
        'nom', rv.reviewer_name, 'resa', rv.resa, 'comment', left(rv.comment, 700), 'prive', left(rv.private_feedback, 500),
        'repondu', rv.reponse is not null or rv.repondu_le is not null, 'peut_repondre', rv.peut_repondre,
        'proprete', (select v from sous s where s.id = rv.id and s.t = 'cleanliness' limit 1)) order by rv.submitted_at desc), '[]'::jsonb)
      from rv left join b on b.id = rv.bien_id) end,
  'proprete_ae', case when p_equipe then (select coalesce(jsonb_agg(jsonb_build_object('ae_id', x.ae_id, 'nom', trim(coalesce(a.prenom, '') || ' ' || coalesce(a.nom, '')),
        'n', x.n, 'moy', x.moy, 'n_bas', x.n_bas, 'n_menage', x.n_menage) order by x.n desc), '[]'::jsonb)
      from (select p.ae_id, count(*) n, avg(p.note) moy, count(*) filter (where p.note <= 3) n_bas, count(*) filter (where p.parle_menage) n_menage
              from _avis_proprete_attribues(p_debut - 400) p
             where (p.submitted_at at time zone 'Europe/Paris')::date between p_debut and p_fin and p.bien_id = any(p_biens)
             group by p.ae_id) x left join auto_entrepreneur a on a.id = x.ae_id) end
);
$$;
revoke all on function public.ph_metrics_avis_calc(uuid[], date, date, boolean, boolean) from public, anon, authenticated;

create or replace function public.ph_metrics_avis(p_periodes jsonb, p_agence text default null, p_biens uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_biens uuid[]; v_eq boolean; v_res jsonb := '[]'::jsonb; p jsonb; d1 date; f1 date; k int;
begin
  v_biens := ph_metrics_biens_onglet(p_agence, p_biens, false);
  v_eq := ph_metrics_droit_equipe();
  if jsonb_typeof(p_periodes) <> 'array' or jsonb_array_length(p_periodes) not between 1 and 4 then raise exception 'periode_invalide'; end if;
  for k in 0 .. jsonb_array_length(p_periodes) - 1 loop
    p := p_periodes -> k; d1 := (p->>'debut')::date; f1 := (p->>'fin')::date;
    if d1 is null or f1 is null or f1 < d1 or f1 - d1 > 731 then raise exception 'periode_invalide'; end if;
    v_res := v_res || jsonb_build_array(ph_metrics_avis_calc(v_biens, d1, f1, v_eq, k = 0));
  end loop;
  return jsonb_build_object('equipe', v_eq, 'nb_biens', coalesce(array_length(v_biens, 1), 0), 'periodes', v_res,
    'reponses_depuis', (select min(submitted_at) from reservation_review where peut_repondre is not null),
    'a_repondre', (select coalesce(jsonb_agg(x order by x->>'le' desc), '[]'::jsonb) from (
       select jsonb_build_object('id', rv.id, 'bien', b.code, 'le', rv.submitted_at, 'note', rv.rating, 'nom', rv.reviewer_name,
              'plateforme', coalesce(rv.plateforme, r.platform), 'comment', left(rv.comment, 300)) x
         from reservation_review rv left join reservation r on r.id = rv.reservation_id
         join bien b on b.id = coalesce(r.bien_id, rv.bien_id)
        where b.id = any(v_biens) and rv.peut_repondre and rv.reponse is null and rv.repondu_le is null
        order by rv.submitted_at desc limit 40) z));
end $$;
revoke all on function public.ph_metrics_avis(jsonb, text, uuid[]) from public, anon;
grant execute on function public.ph_metrics_avis(jsonb, text, uuid[]) to authenticated;

-- ─── 5. Missions ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.ph_metrics_missions_calc(p_biens uuid[], p_sans_bien boolean, p_debut date, p_fin date, p_equipe boolean)
returns jsonb language sql stable security definer set search_path to 'public' as $$
with r as (select depassement_pct from mission_verif_reglage where id = 1),
h as (
  select h.* from mission_hub_periode(p_debut, p_fin) h
   where h.date_mission between p_debut and p_fin
     and (h.bien_id = any(p_biens) or (p_sans_bien and h.bien_id is null))
),
mi as (
  select h.*, m.montant, m.titre_ical, coalesce(m.impute_salaire, false) as impute_salaire,
         ma.assigne_le, ma.accepte_le, ma.refuse_le,
         -- délai d'acceptation : hors initialisation du circuit (toutes les missions assignées le 09/10/2026 11:21:43)
         case when ma.accepte_le is not null and ma.assigne_le is not null
               and not (ma.assigne_le >= '2026-10-09 11:21:43+00' and ma.assigne_le < '2026-10-09 11:21:44+00')
              then greatest(0, extract(epoch from (ma.accepte_le - ma.assigne_le)) / 60.0) end as delai_acc_min,
         (h.prevu_min > 0 and h.mesure_min is not null and not coalesce(h.fin_oubliee, false)
           and h.mesure_min > h.prevu_min * (1 + (select depassement_pct from r) / 100.0) and h.mesure_min - h.prevu_min >= 10) as depasse,
         case when m.statut = 'valide' and coalesce(m.titre_ical, '') not like 'Maintenance%' and not coalesce(m.impute_salaire, false)
              then coalesce(m.montant, 0) else 0 end as cout
    from h join mission_menage m on m.id = h.mission_id
    left join mission_acceptation ma on ma.mission_id = m.id and ma.ae_id = m.ae_id
   where h.source = 'mission'
),
ex as (
  select x.*, (select coalesce(m.type_mission, '') from mission_menage m where m.id = x.mission_id) as tm
    from prestation_hors_forfait x
   where x.date_prestation between p_debut and p_fin and coalesce(x.statut, '') not in ('cancelled', 'annule')
     and (x.bien_id = any(p_biens) or (p_sans_bien and x.bien_id is null))
),
sans as (  -- tâches Hospitable du hub sans AE (miroir depuis le 10/10/2026)
  select count(*) n from h where h.source = 'hospitable' and h.etat = 'a_attribuer'
),
agg as (
  select null::text as k, count(*) n, sum(prevu_min) prevu, count(*) filter (where mesure_min is not null) n_mesure,
         sum(mesure_min) filter (where mesure_min is not null) mesure, sum(prevu_min) filter (where mesure_min is not null) prevu_mesure,
         count(*) filter (where depasse) n_depasse, sum(mesure_min - prevu_min) filter (where depasse) min_depasse,
         count(*) filter (where t_statut = 'terminee') n_terminee, count(*) filter (where t_statut is not null) n_ma_journee,
         count(*) filter (where video_media_id is not null) n_video,
         count(*) filter (where controle_statut = 'ok') n_verifiee, count(*) filter (where controle_statut = 'a_reprendre') n_a_reprendre,
         count(*) filter (where groupe = 'verifier') n_a_verifier, count(*) filter (where etat = 'jamais_demarree') n_jamais,
         count(*) filter (where non_faite) n_non_faite, count(*) filter (where ae_id is null) n_sans_ae_mission,
         count(*) filter (where acc_statut = 'refusee' or refuse_le is not null) n_refus,
         count(*) filter (where delai_acc_min is not null) n_acc, avg(delai_acc_min) delai_moy,
         percentile_cont(0.5) within group (order by delai_acc_min) delai_med,
         count(*) filter (where acc_statut = 'en_attente') n_acc_attente, count(*) filter (where acc_en_retard) n_acc_retard,
         count(*) filter (where mission_statut = 'valide') n_valide, count(*) filter (where hors_paie) n_hors_paie,
         sum(cout) cout, sum(nb_tech + nb_sig) n_signal
    from mi
)
select jsonb_build_object(
  'totaux', (select to_jsonb(agg) - 'k' || jsonb_build_object(
      'cout', case when p_equipe then agg.cout end,
      'n_sans_ae_hospitable', (select n from sans),
      'extras_n', (select count(*) from ex), 'extras_min', (select coalesce(sum(duree_minutes), 0) from ex),
      'extras_valide', (select count(*) from ex where statut = 'valide'), 'extras_attente', (select count(*) from ex where statut = 'en_attente'),
      'extras_refuse', (select count(*) from ex where statut = 'refuse'), 'extras_hors_circuit', (select count(*) from ex where statut = 'regle_hors_circuit'),
      'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where statut = 'valide' and not coalesce(impute_salaire, false)) end)
    from agg),
  'types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'n', n, 'prevu', prevu, 'n_mesure', n_mesure, 'mesure', mesure,
        'prevu_mesure', prevu_mesure, 'n_depasse', n_depasse, 'cout', case when p_equipe then cout end) order by n desc), '[]'::jsonb)
      from (select type, count(*) n, sum(prevu_min) prevu, count(*) filter (where mesure_min is not null) n_mesure, sum(mesure_min) mesure,
                   sum(prevu_min) filter (where mesure_min is not null) prevu_mesure, count(*) filter (where depasse) n_depasse, sum(cout) cout
              from mi group by type) x),
  'ae', (select coalesce(jsonb_agg(jsonb_build_object('ae_id', ae_id, 'nom', nom, 'n', n, 'prevu', prevu, 'n_mesure', n_mesure, 'mesure', mesure,
        'prevu_mesure', prevu_mesure, 'n_depasse', n_depasse, 'n_verifiee', n_verifiee, 'n_a_reprendre', n_a_reprendre, 'n_refus', n_refus,
        'n_acc', n_acc, 'delai_moy', delai_moy, 'n_menage', n_menage,
        'extras_n', (select count(*) from ex where ex.ae_id = x.ae_id),
        'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where ex.ae_id = x.ae_id and statut = 'valide' and not coalesce(impute_salaire, false)) end,
        'cout', case when p_equipe then cout end) order by n desc), '[]'::jsonb)
      from (select ae_id, max(trim(coalesce(ae_prenom, '') || ' ' || coalesce(ae_nom, ''))) nom, count(*) n, sum(prevu_min) prevu,
                   count(*) filter (where mesure_min is not null) n_mesure, sum(mesure_min) mesure, sum(prevu_min) filter (where mesure_min is not null) prevu_mesure,
                   count(*) filter (where depasse) n_depasse, count(*) filter (where controle_statut = 'ok') n_verifiee,
                   count(*) filter (where controle_statut = 'a_reprendre') n_a_reprendre, count(*) filter (where acc_statut = 'refusee' or refuse_le is not null) n_refus,
                   count(*) filter (where delai_acc_min is not null) n_acc, avg(delai_acc_min) delai_moy,
                   count(*) filter (where type = 'menage') n_menage, sum(cout) cout
              from mi group by ae_id) x),
  'biens', (select coalesce(jsonb_agg(jsonb_build_object('id', bien_id, 'code', code, 'agence', agence, 'n', n, 'n_menage', n_menage, 'prevu', prevu,
        'n_mesure', n_mesure, 'mesure', mesure, 'prevu_mesure', prevu_mesure, 'n_depasse', n_depasse, 'n_a_reprendre', n_a_reprendre,
        'extras_n', (select count(*) from ex where ex.bien_id = x.bien_id),
        'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where ex.bien_id = x.bien_id and statut = 'valide' and not coalesce(impute_salaire, false)) end,
        'cout', case when p_equipe then cout end) order by code), '[]'::jsonb)
      from (select bien_id, max(bien_code) code, max(agence) agence, count(*) n, count(*) filter (where type = 'menage') n_menage, sum(prevu_min) prevu,
                   count(*) filter (where mesure_min is not null) n_mesure, sum(mesure_min) mesure, sum(prevu_min) filter (where mesure_min is not null) prevu_mesure,
                   count(*) filter (where depasse) n_depasse, count(*) filter (where controle_statut = 'a_reprendre') n_a_reprendre, sum(cout) cout
              from mi group by bien_id) x),
  'mois', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'n_menage', n_menage, 'prevu', prevu, 'mesure', mesure, 'n_mesure', n_mesure,
        'n_depasse', n_depasse, 'cout', case when p_equipe then cout end,
        'extras_cout', case when p_equipe then (select coalesce(sum(montant), 0) from ex where to_char(ex.date_prestation, 'YYYY-MM') = x.m and statut = 'valide' and not coalesce(impute_salaire, false)) end) order by m), '[]'::jsonb)
      from (select to_char(date_mission, 'YYYY-MM') m, count(*) n, count(*) filter (where type = 'menage') n_menage, sum(prevu_min) prevu, sum(mesure_min) mesure,
                   count(*) filter (where mesure_min is not null) n_mesure, count(*) filter (where depasse) n_depasse, sum(cout) cout
              from mi group by 1) x),
  'jours', (select coalesce(jsonb_agg(jsonb_build_array(d::date, coalesce(x.n, 0), coalesce(x.cout, 0)) order by d), '[]'::jsonb)
      from generate_series(p_debut, p_fin, interval '1 day') d
      left join (select date_mission, count(*) n, sum(cout) cout from mi group by 1) x on x.date_mission = d::date),
  'extras_types', (select coalesce(jsonb_agg(jsonb_build_object('type', t, 'n', n, 'min', mn, 'cout', case when p_equipe then cout end) order by n desc), '[]'::jsonb)
      from (select coalesce(pt.nom, 'Sans type') t, count(*) n, coalesce(sum(ex.duree_minutes), 0) mn,
                   coalesce(sum(ex.montant) filter (where ex.statut = 'valide' and not coalesce(ex.impute_salaire, false)), 0) cout
              from ex left join prestation_type pt on pt.id = ex.prestation_type_id group by 1) y),
  'reprendre', (select coalesce(jsonb_agg(jsonb_build_object('mission_id', mission_id, 'bien', bien_code, 'jour', date_mission, 'type', type,
        'ae', trim(coalesce(ae_prenom, '') || ' ' || coalesce(ae_nom, '')), 'etat', etat, 'pourquoi', coalesce(controle_note, pourquoi),
        'prevu', prevu_min, 'mesure', mesure_min) order by date_mission desc), '[]'::jsonb)
      from mi where controle_statut = 'a_reprendre' or groupe in ('verifier', 'boucler') or depasse)
);
$$;
revoke all on function public.ph_metrics_missions_calc(uuid[], boolean, date, date, boolean) from public, anon, authenticated;

create or replace function public.ph_metrics_missions(p_periodes jsonb, p_agence text default null, p_biens uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_biens uuid[]; v_eq boolean; v_per text; v_sans boolean; v_res jsonb := '[]'::jsonb; p jsonb; d1 date; f1 date; k int;
begin
  v_biens := ph_metrics_biens_onglet(p_agence, p_biens, true);
  select d.perimetre into v_per from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf';
  v_sans := v_per = 'tout' and p_agence is null and p_biens is null;  -- missions sans bien : seulement pour « tout », sans filtre
  v_eq := ph_metrics_droit_equipe();
  if jsonb_typeof(p_periodes) <> 'array' or jsonb_array_length(p_periodes) not between 1 and 4 then raise exception 'periode_invalide'; end if;
  for k in 0 .. jsonb_array_length(p_periodes) - 1 loop
    p := p_periodes -> k; d1 := (p->>'debut')::date; f1 := (p->>'fin')::date;
    if d1 is null or f1 is null or f1 < d1 or f1 - d1 > 731 then raise exception 'periode_invalide'; end if;
    v_res := v_res || jsonb_build_array(ph_metrics_missions_calc(v_biens, v_sans, d1, f1, v_eq));
  end loop;
  return jsonb_build_object('equipe', v_eq, 'nb_biens', coalesce(array_length(v_biens, 1), 0), 'periodes', v_res,
    'depuis', (select min(date_mission) from mission_menage), 'ma_journee_depuis', (select min(created_at) from mission_terrain),
    'acceptation_depuis', (select min(created_at) from mission_acceptation), 'hospitable_depuis', (select min(created_at) from hospitable_tache));
end $$;
revoke all on function public.ph_metrics_missions(jsonb, text, uuid[]) from public, anon;
grant execute on function public.ph_metrics_missions(jsonb, text, uuid[]) to authenticated;
