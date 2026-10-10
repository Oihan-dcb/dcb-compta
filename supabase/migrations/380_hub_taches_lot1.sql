-- 380 — Hub des tâches terrain PowerHouse, Lot 1 (10/10/2026)
--
-- Proposition : ~/Downloads/Proposition_hub_taches_PowerHouse_2026-10-10.md, maquette v3 validée.
-- Additif uniquement : aucune table métier modifiée, aucun trigger posé sur les sources.
--
--   • hospitable_tache       : miroir des tâches Hospitable (/v2/tasks), alimenté toutes les 15 min par
--                              api/cron-hospitable-taches (PowerHouse). Seul moyen de voir une tâche NON
--                              assignée : mission_menage n'est alimentée que par l'iCal des AE.
--   • mission_journal        : gestes du bureau (vérification, relance, réattribution, bouclage…).
--   • mission_verif_reglage  : réglages « Quand vérifier une mission ? » (ligne unique, éditée dans
--                              Planning › ⚙ Réglages). Recouche automatique : désactivée par défaut.
--   • mission_hub_v          : une ligne par mission (et par tâche Hospitable sans mission) avec le cycle
--                              complet (attribuée › acceptée › démarrée › vidéo › vérifiée), l'état en clair,
--                              la raison « pourquoi » et le groupe d'action (trouver_ae / relancer / boucler /
--                              verifier) de l'onglet « À faire ».
--
-- Accès : RLS activée SANS policy et privilèges retirés à anon/authenticated → lecture/écriture
-- uniquement par les endpoints PowerHouse (service_role) qui contrôlent l'appelant (_phCaller) et
-- filtrent par périmètre (_scope : Léa = ses biens Bordeaux/Bassin). Les AE n'y ont jamais accès.

-- ── 1. Miroir des tâches Hospitable ─────────────────────────────────────────
create table if not exists public.hospitable_tache (
  task_id            text primary key,
  property_id        text,
  bien_id            uuid references public.bien(id) on delete set null,
  reservation_id     text,
  reservation_code   text,
  task_type          int,                 -- 1 Ménage · 2 Check-in · 3 Conciergerie · 4 Check-out · 5 Maintenance
  type_ph            text,                -- menage | check_in | check_out | recouche | technique | conciergerie
  nom                text,
  debut              timestamptz,
  fin                timestamptz,
  duree_h            numeric,
  note               text,
  teammate_id        text,
  teammate_nom       text,
  ae_id              uuid references public.auto_entrepreneur(id) on delete set null, -- rapproché par le NOM
  assignment_status  text,                -- pending | accepted | rejected | cancelled | unassigned
  assignment_maj     timestamptz,
  progress_status    text,
  vu_le              timestamptz not null default now(),
  disparu_le         timestamptz,         -- absente de l'API lors d'une lecture couvrant sa date
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists hospitable_tache_debut_idx on public.hospitable_tache (debut);
create index if not exists hospitable_tache_bien_idx on public.hospitable_tache (bien_id, debut);

-- ── 2. Journal des gestes du bureau ─────────────────────────────────────────
create table if not exists public.mission_journal (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid references public.mission_menage(id) on delete cascade,
  task_id     text,
  bien_id     uuid,
  type        text not null check (type in ('verification', 'relance', 'reattribution', 'boucle_fait', 'boucle_non_faite', 'note', 'reglage')),
  avant       jsonb,
  apres       jsonb,
  texte       text,
  auteur_id   uuid,
  auteur_nom  text,
  created_at  timestamptz not null default now()
);
create index if not exists mission_journal_mission_idx on public.mission_journal (mission_id, created_at desc);
create index if not exists mission_journal_type_idx on public.mission_journal (type, created_at desc);

-- ── 3. Réglages de vérification (ligne unique) ──────────────────────────────
create table if not exists public.mission_verif_reglage (
  id                          int primary key default 1 check (id = 1),
  si_depassement              boolean not null default true,
  depassement_pct             int not null default 30 check (depassement_pct between 0 and 300),
  si_ecart_declare            boolean not null default true,
  ecart_declare_min           int not null default 15 check (ecart_declare_min between 0 and 240),
  si_sans_video               boolean not null default true,
  si_probleme                 boolean not null default true,
  si_position                 boolean not null default true,
  si_fin_oubliee              boolean not null default true,
  echantillon_actif           boolean not null default true,
  echantillon_pct             int not null default 20 check (echantillon_pct between 0 and 100),
  toujours_ae                 uuid[] not null default '{}',
  toujours_biens              uuid[] not null default '{}',
  delai_h                     int not null default 48 check (delai_h between 1 and 720),
  jour_limite                 int not null default 3 check (jour_limite between 1 and 28),
  boucler_depuis              date not null default '2026-10-05', -- lancement de Ma journée : rien à boucler avant
  recouche_auto               boolean not null default false,     -- option NON activée (décision Oïhan 10/10/2026)
  recouche_proposer_nuits     int not null default 5,
  recouche_systematique_nuits int not null default 7,
  updated_at                  timestamptz not null default now(),
  updated_par                 uuid
);
insert into public.mission_verif_reglage (id) values (1) on conflict (id) do nothing;

-- ── 4. Fermeture : service_role uniquement ──────────────────────────────────
alter table public.hospitable_tache enable row level security;
alter table public.mission_journal enable row level security;
alter table public.mission_verif_reglage enable row level security;
revoke all on public.hospitable_tache, public.mission_journal, public.mission_verif_reglage from anon, authenticated;
grant all on public.hospitable_tache, public.mission_journal, public.mission_verif_reglage to service_role;

-- ── 5. Vue du hub ───────────────────────────────────────────────────────────
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
                and base.mesure_min > base.prevu_min * (1 + r.depassement_pct / 100.0)
           then base.mesure_min || ' min pour ' || base.prevu_min || ' prévues (+' || round(100.0 * (base.mesure_min - base.prevu_min) / base.prevu_min) || ' %)' end,
      case when r.si_ecart_declare and base.duree_declaree_minutes is not null and base.mesure_min is not null and not coalesce(base.fin_oubliee, false)
                and abs(base.duree_declaree_minutes - base.mesure_min) > r.ecart_declare_min
           then base.duree_declaree_minutes || ' min déclarées, ' || base.mesure_min || ' au chrono' end,
      case when r.si_sans_video and base.video_media_id is null
           then 'pas de vidéo' || coalesce(' (' || left(base.video_absente_motif, 80) || ')', '') end,
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
    r.boucler_depuis
  from base cross join r
),
etat as (
  select calc.*,
    (calc.terminee_ae and (cardinality(calc.anomalies) > 0 or calc.toujours or calc.tiree)) as a_verifier,
    (calc.acc_statut = 'en_attente' and calc.echeance_bureau <= now()) as acc_en_retard,
    (calc.t_statut is null and coalesce(calc.mission_statut, '') <> 'valide' and not calc.non_faite
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
  e.anomalies, e.toujours, e.tiree, e.a_verifier, e.verif_echeance,
  -- les 5 cellules : f fait · c en attente · k bloque · v vérifiée · x pas besoin · '' à venir
  array[
    'f',
    case when e.acc_statut = 'refusee' then 'k' when e.acc_statut = 'en_attente' then case when e.acc_en_retard then 'k' else 'c' end else 'f' end,
    case when e.t_statut = 'en_cours' then 'c' when e.t_statut is not null then 'f'
         when e.non_faite or e.jamais_demarree then 'k' else '' end,
    case when e.t_statut = 'video_attendue' then case when e.date_mission < e.aujourdhui then 'k' else 'c' end
         when e.t_statut = 'terminee' then case when e.video_media_id is not null then 'f' else 'x' end else '' end,
    case when e.controle_statut = 'ok' then 'v' when e.controle_statut = 'a_reprendre' then 'k'
         when e.t_statut = 'terminee' then case when e.a_verifier then 'c' else 'x' end else '' end
  ] as etapes,
  case
    when e.acc_statut = 'refusee' then 'refusee'
    when e.non_faite then 'non_faite'
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
    when e.acc_statut = 'en_attente' and e.date_mission >= e.aujourdhui then 'relancer'
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
  end as pourquoi
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
       else 'Assignée à ' || coalesce(h.teammate_nom, '?') || ' dans Hospitable, pas encore dans son agenda PowerHouse' end
from public.hospitable_tache h
left join public.bien b on b.id = h.bien_id
left join public.auto_entrepreneur a on a.id = h.ae_id
where h.disparu_le is null
  and coalesce(h.assignment_status, '') <> 'cancelled'
  and h.debut >= now() - interval '62 days'
  and not exists (select 1 from public.mission_menage m where m.ical_uid = h.task_id || '@smartbnb.io' and coalesce(m.statut, '') not in ('cancelled', 'refuse'));

revoke all on public.mission_hub_v from anon, authenticated;
grant select on public.mission_hub_v to service_role;

comment on view public.mission_hub_v is 'Hub des tâches terrain (PowerHouse Lot 1, migration 380) : cycle complet par mission + groupe d''action. Lecture service_role uniquement (endpoint api/mission-hub, filtrage par périmètre).';
