-- 389 — Hub des tâches terrain : Lot 2 (Historique, lecture) + Lot 3b partie 1 (attribution PROPOSÉE).
-- 10/10/2026, PowerHouse (api/mission-hub.js). Aucune donnée nouvelle, aucune écriture : deux fonctions
-- de lecture, service_role uniquement (l'endpoint PowerHouse applique droits et périmètre).
--
-- 1. mission_historique(...) : chronologie reconstruite à partir des horodatages existants
--    (mission_menage.created_at = arrivée dans l'agenda via l'iCal Hospitable ; mission_acceptation :
--    assignation, notification, rappel +24 h, alerte bureau, acceptation, refus, refus signalé, refus
--    traité, retrait Hospitable ; terrain_rappel ; mission_terrain : démarrage, fin, vidéo, vérification ;
--    video_annotation ; tech_issues / signalements rattachés à une mission ; hospitable_tache.disparu_le ;
--    mission_journal pour les gestes du bureau). Les lignes d'acceptation « reprise » / « non_requise »
--    (initialisation du 09/10/2026, sans événement réel) sont ignorées.
-- 2. mission_propositions_ae(mission, tâche) : qui proposer pour une mission à attribuer.
--    Écartés : AE inactif / hors secteur / ayant refusé cette mission / déjà dessus / en congé (staff_leave
--    non récurrent, exceptions respectées) / en jour off (staff_off, matin-après-midi selon l'heure) SAUF si
--    ce off tombe sur un repos récurrent (même règle que le Lot 3a, 384) / mission qui chevauche.
--    Repos récurrent : PAS écarté (un AE a le droit de travailler sur ses repos, règle Oïhan 10/10) mais
--    classé après les disponibles. Classement : note de propreté pondérée (moyenne bayésienne
--    (n·moy + 10·moy_globale)/(n+10), avis 12 mois attribués au ménage, _avis_proprete_attribues 306),
--    puis charge du jour (nombre de missions, puis minutes). Pas d'AE titulaire par bien.

create or replace function public._nom_auth_user(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(a.prenom), '') from auto_entrepreneur a where a.ae_user_id = p_uid limit 1),
    (select split_part(s.email, '@', 1) from staff_users s where s.auth_user_id = p_uid limit 1),
    case when p_uid is null then null else 'bureau' end)
$$;
revoke all on function public._nom_auth_user(uuid) from public, anon, authenticated;

-- ── 1. Historique ─────────────────────────────────────────────────────────
create or replace function public.mission_historique(
  p_du date default null, p_au date default null,
  p_mission_id uuid default null, p_task_id text default null,
  p_bien_ids uuid[] default null, p_ae_id uuid default null, p_categorie text default null,
  p_limit int default 400)
returns table (
  quand timestamptz, categorie text, genre text, libelle text, acteur text,
  mission_id uuid, task_id text, bien_id uuid, bien_code text, ae_id uuid, ae_prenom text,
  date_mission date, type_mission text
) language sql stable security definer set search_path = public as $$
with
borne as (
  select (coalesce(p_du, current_date - 7)::timestamp at time zone 'Europe/Paris') as t0,
         ((coalesce(p_au, current_date) + 1)::timestamp at time zone 'Europe/Paris') as t1,
         (p_mission_id is not null or p_task_id is not null) as une
),
-- missions concernées (une mission précise, ou toutes ; le filtre temporel porte sur l'événement)
m as (
  select mm.id, mm.bien_id, mm.ae_id, mm.date_mission, mm.heure_mission, mm.type_mission, mm.titre_ical, mm.created_at, mm.statut,
         case when mm.ical_uid ~* '@smartbnb\.io$' then split_part(mm.ical_uid, '@', 1) end as task_id
  from mission_menage mm
  where (p_mission_id is null or mm.id = p_mission_id)
    and (p_task_id is null or mm.ical_uid = p_task_id || '@smartbnb.io')
    and (p_bien_ids is null or mm.bien_id = any (p_bien_ids))
),
ev as (
  -- Arrivée dans l'agenda de l'AE (import iCal Hospitable)
  select m.created_at as quand, 'attribution' as categorie, 'agenda' as genre,
         'Arrivée dans l''agenda de ' || coalesce(a.prenom, '?') || ' (iCal Hospitable)' as libelle, 'iCal Hospitable' as acteur,
         m.id as mission_id, m.task_id, m.bien_id, m.ae_id
  from m left join auto_entrepreneur a on a.id = m.ae_id
  union all
  -- Cycle d'acceptation (mission_acceptation, une ligne par AE assigné)
  select x.quand, x.categorie, x.genre, x.libelle, x.acteur, m.id, m.task_id, m.bien_id, ma.ae_id
  from m join mission_acceptation ma on ma.mission_id = m.id
  left join auto_entrepreneur a on a.id = ma.ae_id
  cross join lateral (values
    (ma.assigne_le, 'attribution', 'assignee', 'Attribuée à ' || coalesce(a.prenom, '?') || case when ma.derniere_minute then ' (dernière minute)' else '' end, 'Hospitable'),
    (ma.notif_ae_le, 'rappels', 'notif_ae', 'Notification « mission à confirmer » envoyée à ' || coalesce(a.prenom, '?'), 'automatique'),
    (ma.rappel_ae_le, 'rappels', 'rappel_ae', 'Rappel envoyé à ' || coalesce(a.prenom, '?') || ' : toujours pas de réponse', 'automatique'),
    (ma.alerte_bureau_le, 'rappels', 'alerte_bureau', 'Alerte au bureau : ' || coalesce(a.prenom, '?') || ' n''a pas répondu à l''échéance', 'automatique'),
    (ma.accepte_le, 'acceptation', 'acceptee', 'Acceptée par ' || coalesce(a.prenom, '?') || case when ma.source = 'hospitable' then ' (appli Hospitable)' else '' end, coalesce(a.prenom, 'AE')),
    (ma.refuse_le, 'acceptation', 'refusee', 'Refusée par ' || coalesce(a.prenom, '?')
        || coalesce(' (' || case ma.refus_motif when 'indisponible' then 'indisponible' when 'horaire' then 'horaire' when 'trop_loin' then 'trop loin'
                                 when 'hospitable' then 'dans l''appli Hospitable' else ma.refus_motif end || ')', '')
        || coalesce(' — ' || nullif(trim(ma.refus_precision), ''), '')
        || case when ma.refus_apres_acceptation then ' après l''avoir acceptée' else '' end, coalesce(a.prenom, 'AE')),
    (ma.refus_notifie_le, 'rappels', 'refus_notifie', 'Refus de ' || coalesce(a.prenom, '?') || ' signalé au bureau', 'automatique'),
    (ma.hospitable_desassigne_le, 'attribution', 'desassignee', coalesce(a.prenom, '?') || ' retiré(e) de la tâche dans Hospitable', 'automatique'),
    (ma.traite_le, 'bureau', 'refus_traite', 'Refus traité par le bureau', coalesce(_nom_auth_user(ma.traite_par), 'bureau'))
  ) as x(quand, categorie, genre, libelle, acteur)
  where x.quand is not null and coalesce(ma.source, '') not in ('reprise', 'non_requise')
  union all
  -- Rappels Ma journée (cron-terrain-rappels)
  select r.envoye_at, 'rappels', 'rappel_' || r.type,
         case r.type when 'demarrage' then 'Rappel à ' || coalesce(a.prenom, '?') || ' : mission pas encore démarrée'
                     when 'soir' then 'Rappel du soir à ' || coalesce(a.prenom, '?') || ' : mission pas bouclée'
                     else 'Rappel ' || r.type || ' à ' || coalesce(a.prenom, '?') end,
         'automatique', m.id, m.task_id, m.bien_id, m.ae_id
  from m join terrain_rappel r on r.mission_id = m.id left join auto_entrepreneur a on a.id = m.ae_id
  union all
  -- Ma journée : démarrage, fin, vidéo, vérification
  select x.quand, x.categorie, x.genre, x.libelle, x.acteur, m.id, m.task_id, m.bien_id, t.ae_id
  from m join mission_terrain t on t.mission_id = m.id
  left join auto_entrepreneur a on a.id = t.ae_id
  cross join lateral (values
    (t.started_at, 'terrain', 'demarree', 'Démarrée' || case when t.start_declare then ' (déclarée après oubli)' else '' end
        || case when t.start_lat is not null or t.start_geo_statut = 'ok' then ', position relevée'
                when t.start_geo_statut = 'refusee' then ', position refusée' else ', position non relevée' end, coalesce(a.prenom, 'AE')),
    (t.ended_at, 'terrain', 'terminee', 'Terminée' || coalesce(' — ' || coalesce(t.duree_corrigee_minutes, t.duree_minutes) || ' min au chrono', '')
        || coalesce(', ' || t.duree_declaree_minutes || ' min déclarées', '') || case when t.fin_oubliee then ' (« Terminer » oublié, déclaré après coup)' else '' end, coalesce(a.prenom, 'AE')),
    (t.video_at, 'terrain', 'video', 'Vidéo de fin envoyée', coalesce(a.prenom, 'AE')),
    (case when t.video_media_id is null and t.video_absente_motif is not null then coalesce(t.ended_at, t.updated_at) end, 'terrain', 'sans_video',
        'Sans vidéo : ' || t.video_absente_motif, coalesce(a.prenom, 'AE')),
    (t.controle_at, 'verification', 'verifiee', case t.controle_statut when 'ok' then 'Vérifiée ✓' when 'a_reprendre' then 'À reprendre ✕' else 'Vérification' end
        || coalesce(' — ' || nullif(trim(t.controle_note), ''), ''), coalesce(_nom_auth_user(t.controle_par), 'bureau'))
  ) as x(quand, categorie, genre, libelle, acteur)
  where x.quand is not null
  union all
  -- Annotations vidéo (et leur lecture par l'AE)
  select x.quand, 'verification', x.genre, x.libelle, x.acteur, m.id, m.task_id, m.bien_id, m.ae_id
  from m join video_annotation v on v.mission_id = m.id
  left join auto_entrepreneur a on a.id = m.ae_id
  cross join lateral (values
    (v.created_at, 'annotation', 'Annotation vidéo ' || case v.type when 'bravo' then '👏 bravo' when 'corriger' then '✏️ à corriger' when 'question' then '❓ question' else coalesce(v.type, '') end
        || ' à ' || floor(coalesce(v.t_secondes, 0) / 60)::int || ':' || lpad((floor(coalesce(v.t_secondes, 0))::int % 60)::text, 2, '0')
        || coalesce(' — ' || left(nullif(trim(v.texte), ''), 140), ''), coalesce(_nom_auth_user(v.created_by), 'bureau')),
    (v.vu_at, 'annotation_vue', 'Annotation vue par ' || coalesce(a.prenom, 'l''AE') || coalesce(' — réponse : ' || left(nullif(trim(v.reponse), ''), 140), ''), coalesce(a.prenom, 'AE'))
  ) as x(quand, genre, libelle, acteur)
  where x.quand is not null
  union all
  -- Problèmes ouverts depuis la mission
  select ti.created_at, 'problemes', 'ticket', 'Ticket technique : ' || coalesce(ti.title, '?') || coalesce(' (' || ti.status || ')', ''),
         coalesce(ti.reported_by, 'AE'), m.id, m.task_id, m.bien_id, m.ae_id
  from m join tech_issues ti on ti.mission_id = m.id
  union all
  select s.created_at, 'problemes', 'signalement', 'Signalement : ' || coalesce(s.type, '?') || coalesce(' — ' || left(nullif(trim(s.description), ''), 120), ''),
         coalesce(s.created_by_name, 'AE'), m.id, m.task_id, m.bien_id, m.ae_id
  from m join signalements s on s.mission_id = m.id
  union all
  -- Tâche Hospitable disparue (supprimée dans Hospitable)
  select h.disparu_le, 'attribution', 'tache_disparue', 'Tâche supprimée dans Hospitable', 'Hospitable',
         (select mm.id from mission_menage mm where mm.ical_uid = h.task_id || '@smartbnb.io' limit 1), h.task_id, h.bien_id, h.ae_id
  from hospitable_tache h
  where h.disparu_le is not null
    and (p_task_id is null or h.task_id = p_task_id)
    and (p_mission_id is null or exists (select 1 from m where m.task_id = h.task_id))
    and (p_bien_ids is null or h.bien_id = any (p_bien_ids))
  union all
  -- Gestes du bureau (mission_journal)
  select j.created_at,
         case when j.type in ('verification') then 'verification' when j.type in ('reattribution') then 'attribution'
              when j.type in ('relance') then 'rappels' else 'bureau' end,
         j.type,
         case j.type when 'verification' then 'Vérification' when 'relance' then 'Relance manuelle' when 'reattribution' then 'Réattribution'
                     when 'boucle_fait' then 'Bouclée' when 'boucle_non_faite' then 'Notée non faite' when 'reglage' then 'Réglages de vérification modifiés'
                     when 'ecart_ignore' then 'Écart jugé normal' when 'extra_regle_hors_circuit' then 'Extra réglé hors circuit' else 'Note' end
           || coalesce(' — ' || nullif(trim(j.texte), ''), ''),
         coalesce(j.auteur_nom, 'bureau'), j.mission_id, j.task_id, j.bien_id,
         coalesce(nullif(j.apres ->> 'ae_id', '')::uuid, (select mm.ae_id from mission_menage mm where mm.id = j.mission_id))
  from mission_journal j
  where (p_mission_id is null or j.mission_id = p_mission_id or (j.task_id is not null and j.task_id = (select m.task_id from m limit 1)))
    and (p_task_id is null or j.task_id = p_task_id or j.mission_id in (select m.id from m))
    and (p_bien_ids is null or j.bien_id = any (p_bien_ids))
)
select ev.quand, ev.categorie, ev.genre, ev.libelle, ev.acteur, ev.mission_id, ev.task_id, ev.bien_id, b.code,
       ev.ae_id, a.prenom, mm.date_mission,
       case when mm.id is null then null
            else coalesce(t.type_terrain, case mm.type_mission when 'checkout' then 'menage' when 'checkin' then 'check_in' when 'recouche' then 'recouche'
                                                               else 'technique' end) end
from ev cross join borne
left join bien b on b.id = ev.bien_id
left join auto_entrepreneur a on a.id = ev.ae_id
left join mission_menage mm on mm.id = ev.mission_id
left join mission_terrain t on t.mission_id = ev.mission_id
where (borne.une or (ev.quand >= borne.t0 and ev.quand < borne.t1))
  and (p_ae_id is null or ev.ae_id = p_ae_id)
  and (p_categorie is null or ev.categorie = p_categorie)
order by ev.quand desc
limit greatest(1, least(coalesce(p_limit, 400), 2000));
$$;
revoke all on function public.mission_historique(date, date, uuid, text, uuid[], uuid, text, int) from public, anon, authenticated;
grant execute on function public.mission_historique(date, date, uuid, text, uuid[], uuid, text, int) to service_role;

-- ── 2. Attribution proposée ───────────────────────────────────────────────
create or replace function public.mission_propositions_ae(p_mission_id uuid default null, p_task_id text default null)
returns table (
  ae_id uuid, prenom text, nom text, statut text, raison text,
  note numeric, nb_avis int, score numeric, nb_missions_jour int, minutes_jour int, rang int
) language sql stable security definer set search_path = public, extensions as $$
with
cible as (
  select v.mission_id, v.task_id, v.bien_id, v.ae_id, v.date_mission as d, v.heure_mission as h, v.debut,
         greatest(coalesce(nullif(v.prevu_min, 0), 60), 15) as duree, coalesce(v.secteur, 'cote-basque') as secteur
  from mission_hub_v v
  where (p_mission_id is not null and v.mission_id = p_mission_id)
     or (p_mission_id is null and p_task_id is not null and v.task_id = p_task_id)
  order by (v.source = 'mission') desc
  limit 1
),
cand as (
  select a.id, a.prenom, a.nom, staff_slug(a.prenom) as slug,
         case when coalesce(cardinality(a.secteurs), 0) > 0 then (select c.secteur from cible c) = any (a.secteurs)
              else (select c.secteur from cible c) = 'cote-basque' end as bon_secteur
  from auto_entrepreneur a
  where a.actif and a.type in ('ae', 'staff') and nullif(trim(a.prenom), '') is not null
),
avis as (
  select x.ae_id, count(*)::int as n, avg(x.note) as moy from _avis_proprete_attribues(current_date - 365) x where x.ae_id is not null group by x.ae_id
),
glob as (select coalesce(sum(n * moy) / nullif(sum(n), 0), 4.7) as g from avis),
-- charge du jour (missions et tâches Hospitable de la même date, sauf celle-ci, hors refus / sans AE)
charge as (
  select v.ae_id, count(*)::int as nb, sum(greatest(coalesce(nullif(v.prevu_min, 0), 60), 15))::int as minutes,
         string_agg(case when v.debut < c.debut + make_interval(mins => c.duree)
                          and v.debut + make_interval(mins => greatest(coalesce(nullif(v.prevu_min, 0), 60), 15)) > c.debut
                         then coalesce(v.bien_code, '?') || ' ' || to_char(v.debut at time zone 'Europe/Paris', 'HH24:MI') || '–'
                              || to_char((v.debut + make_interval(mins => greatest(coalesce(nullif(v.prevu_min, 0), 60), 15))) at time zone 'Europe/Paris', 'HH24:MI') end, ', ') as chevauche
  from mission_hub_v v cross join cible c
  where v.date_mission = c.d and v.ae_id is not null
    and coalesce(v.etat, '') not in ('refusee', 'a_attribuer', 'non_faite')
    and not (c.mission_id is not null and v.mission_id is not distinct from c.mission_id)
    and not (c.task_id is not null and v.task_id is not distinct from c.task_id)
  group by v.ae_id
),
eval as (
  select k.id, k.prenom, k.nom, k.bon_secteur,
    (k.id = c.ae_id) as deja_dessus,
    exists (select 1 from mission_acceptation ma where ma.mission_id = c.mission_id and ma.ae_id = k.id and (ma.statut = 'refusee' or ma.refuse_le is not null)) as a_refuse,
    (select 'en congé du ' || to_char(l.start_date::date, 'DD/MM/YYYY') || ' au ' || to_char(l.end_date::date, 'DD/MM/YYYY')
       from staff_leave l
      where l.staff_id = k.slug and coalesce(l.type, '') <> 'repos' and coalesce(l.recurring, '') = ''
        and c.d between l.start_date::date and l.end_date::date
        and not (c.d::text = any (string_to_array(coalesce(l.exceptions, ''), ',')))
      limit 1) as conge,
    exists (select 1 from staff_leave rp
             where rp.staff_id = k.slug and rp.type = 'repos' and coalesce(rp.recurring, '') <> ''
               and extract(dow from c.d)::text = any (string_to_array(rp.recurring, ','))
               and not (c.d::text = any (string_to_array(coalesce(rp.exceptions, ''), ',')))) as repos,
    (select 'en jour off' || case when o.am_off and o.pm_off then '' when o.am_off then ' le matin' else ' l''après-midi' end
       from staff_off o
      where o.staff_id = k.slug and o.date = c.d::text
        and (o.am_off and o.pm_off or (o.am_off and coalesce(c.h, time '10:00') < time '13:00') or (o.pm_off and coalesce(c.h, time '10:00') >= time '13:00'))
      limit 1) as off_brut,
    av.n, av.moy, ch.nb, ch.minutes, ch.chevauche,
    round(((coalesce(av.n, 0) * coalesce(av.moy, 0)) + 10 * g.g) / (coalesce(av.n, 0) + 10), 3) as score
  from cand k cross join cible c cross join glob g
  left join avis av on av.ae_id = k.id
  left join charge ch on ch.ae_id = k.id
),
classe as (
  select e.*,
    case when not e.bon_secteur then 'ecarte'
         when e.deja_dessus then 'ecarte'
         when e.a_refuse then 'ecarte'
         when e.conge is not null then 'ecarte'
         when e.off_brut is not null and not e.repos then 'ecarte'
         when e.chevauche is not null then 'ecarte'
         when e.repos then 'repos'
         else 'propose' end as st,
    case when not e.bon_secteur then 'autre secteur'
         when e.deja_dessus then 'déjà sur la mission'
         when e.a_refuse then 'a refusé cette mission'
         when e.conge is not null then e.conge
         when e.off_brut is not null and not e.repos then e.off_brut
         when e.chevauche is not null then 'déjà pris : ' || e.chevauche
         when e.repos then 'jour de repos habituel (peut accepter)'
         else 'disponible' end as pourquoi
  from eval e
)
select c.id, c.prenom, c.nom, c.st, c.pourquoi, round(c.moy, 2), coalesce(c.n, 0), c.score, coalesce(c.nb, 0), coalesce(c.minutes, 0),
       case when c.st = 'ecarte' then null
            else (row_number() over (partition by (c.st = 'ecarte')
                   order by (c.st = 'repos'), c.score desc, coalesce(c.nb, 0), coalesce(c.minutes, 0), c.prenom))::int end
from classe c
where c.bon_secteur  -- les autres secteurs ne sont même pas listés
order by (c.st = 'ecarte'), (c.st = 'repos'), c.score desc, coalesce(c.nb, 0), coalesce(c.minutes, 0), c.prenom;
$$;
revoke all on function public.mission_propositions_ae(uuid, text) from public, anon, authenticated;
grant execute on function public.mission_propositions_ae(uuid, text) to service_role;
