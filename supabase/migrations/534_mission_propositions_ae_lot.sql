-- 534 — Propositions d'AE pour PLUSIEURS missions/tâches en un seul appel (22/10/2026).
-- Cause : le hub des tâches (api/mission-hub.js, propositionsLignes) lançait jusqu'à 12 appels parallèles de
-- mission_propositions_ae (≈ 2,8 s chacun dont 1,4 s de planification, avis de propreté sur 1 an recalculés à
-- chaque fois). Sur le serveur MICRO, ces rafales dépassaient le statement_timeout (120 expirations le 22/10) et
-- faisaient expirer tout ce qui tombait en même temps (ex. envoi des remarques vidéo terrain).
-- Même règle que mission_propositions_ae (389), mais cibles multiples : avis, moyenne globale et candidats
-- calculés UNE fois. Chaque ligne porte sa clé : 'm:<mission_id>' ou 't:<task_id>' (clé telle que demandée).

create or replace function public.mission_propositions_ae_lot(p_mission_ids uuid[] default '{}', p_task_ids text[] default '{}')
returns table(cle text, ae_id uuid, prenom text, nom text, statut text, raison text, note numeric, nb_avis integer, score numeric,
              nb_missions_jour integer, minutes_jour integer, rang integer)
language sql
stable security definer
set search_path to 'public', 'extensions'
as $function$
with
cible as (
  select distinct on (x.cle) x.*
  from (
    select case when v.mission_id = any (coalesce(p_mission_ids, '{}')) then 'm:' || v.mission_id::text else 't:' || v.task_id end as cle,
           v.source, v.mission_id, v.task_id, v.bien_id, v.ae_id, v.date_mission as d, v.heure_mission as h, v.debut,
           greatest(coalesce(nullif(v.prevu_min, 0), 60), 15) as duree, coalesce(v.secteur, 'cote-basque') as secteur
    from mission_hub_v v
    where v.mission_id = any (coalesce(p_mission_ids, '{}')) or v.task_id = any (coalesce(p_task_ids, '{}'))
  ) x
  where (x.cle like 'm:%' and x.mission_id = any (coalesce(p_mission_ids, '{}')))
     or (x.cle like 't:%' and x.task_id = any (coalesce(p_task_ids, '{}')))
  order by x.cle, (x.source = 'mission') desc
),
cand as (
  select a.id, a.prenom, a.nom, staff_slug(a.prenom) as slug, a.secteurs
  from auto_entrepreneur a
  where a.actif and a.type in ('ae', 'staff') and nullif(trim(a.prenom), '') is not null
),
avis as (
  select x.ae_id, count(*)::int as n, avg(x.note) as moy from _avis_proprete_attribues(current_date - 365) x where x.ae_id is not null group by x.ae_id
),
glob as (select coalesce(sum(n * moy) / nullif(sum(n), 0), 4.7) as g from avis),
jours as (
  select v.date_mission, v.ae_id, v.mission_id, v.task_id, v.bien_code, v.debut, greatest(coalesce(nullif(v.prevu_min, 0), 60), 15) as duree_v
  from mission_hub_v v
  where v.date_mission in (select d from cible) and v.ae_id is not null
    and coalesce(v.etat, '') not in ('refusee', 'a_attribuer', 'non_faite')
),
charge as (
  select c.cle, j.ae_id, count(*)::int as nb, sum(j.duree_v)::int as minutes,
         string_agg(case when j.debut < c.debut + make_interval(mins => c.duree)
                          and j.debut + make_interval(mins => j.duree_v) > c.debut
                         then coalesce(j.bien_code, '?') || ' ' || to_char(j.debut at time zone 'Europe/Paris', 'HH24:MI') || '–'
                              || to_char((j.debut + make_interval(mins => j.duree_v)) at time zone 'Europe/Paris', 'HH24:MI') end, ', ') as chevauche
  from cible c join jours j on j.date_mission = c.d
  where not (c.mission_id is not null and j.mission_id is not distinct from c.mission_id)
    and not (c.task_id is not null and j.task_id is not distinct from c.task_id)
  group by c.cle, j.ae_id
),
eval as (
  select c.cle, k.id, k.prenom, k.nom,
    case when coalesce(cardinality(k.secteurs), 0) > 0 then c.secteur = any (k.secteurs) else c.secteur = 'cote-basque' end as bon_secteur,
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
  from cible c cross join cand k cross join glob g
  left join avis av on av.ae_id = k.id
  left join charge ch on ch.ae_id = k.id and ch.cle = c.cle
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
select c.cle, c.id, c.prenom, c.nom, c.st, c.pourquoi, round(c.moy, 2), coalesce(c.n, 0), c.score, coalesce(c.nb, 0), coalesce(c.minutes, 0),
       case when c.st = 'ecarte' then null
            else (row_number() over (partition by c.cle, (c.st = 'ecarte')
                   order by (c.st = 'repos'), c.score desc, coalesce(c.nb, 0), coalesce(c.minutes, 0), c.prenom))::int end
from classe c
where c.bon_secteur
order by c.cle, (c.st = 'ecarte'), (c.st = 'repos'), c.score desc, coalesce(c.nb, 0), coalesce(c.minutes, 0), c.prenom;
$function$;

revoke all on function public.mission_propositions_ae_lot(uuid[], text[]) from public, anon;
grant execute on function public.mission_propositions_ae_lot(uuid[], text[]) to service_role;
