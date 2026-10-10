-- 390 — Hub des tâches : la relance devient un MESSAGE dans la conversation équipe de l'AE (10/10/2026,
-- décision Oïhan : « une notification seule ne laisse pas de trace »).
--
-- hub_salle_ae(ae)          : la conversation de l'AE, même règle que terrain_poster (377) :
--                             1. staff_room à son nom (prénom + nom, puis prénom seul) dont il est membre ;
--                             2. sinon son groupe manager_group ; 3. sinon rien.
--                             (_terrain_room_staff / terrain_salle_du_staff, utilisé par « À reprendre »,
--                             n'a pas le repli manager_group et exclut les managers : non réutilisé ici.)
-- hub_relance_poster(m, t)  : appelée AVEC LE JWT du bureau (droits _terrain_check_bureau : bureau, ou staff
--                             scopé sur ses biens) ; insère le message au nom de la personne du bureau
--                             (_chat_sender() = son compte portail relié), renvoie message/salle pour que
--                             l'endpoint envoie UNE notification de chat à l'AE.
-- + mission_historique : l'horodatage d'initialisation du circuit d'acceptation (09/10/2026 11:21:43 UTC,
--   même valeur posée sur toutes les lignes existantes par la migration 374) n'est pas une assignation réelle.

create or replace function public.hub_salle_ae(p_ae_id uuid)
returns table (room_id uuid, room_name text, ae_user_id uuid)
language sql stable security definer set search_path = public as $$
  with a as (
    select x.ae_user_id,
           coalesce(nullif(trim(coalesce(x.prenom, '')), ''), nullif(trim(coalesce(x.nom, '')), '')) as prenom,
           nullif(trim(trim(coalesce(x.prenom, '')) || ' ' || trim(coalesce(x.nom, ''))), '') as nom_complet
    from auto_entrepreneur x where x.id = p_ae_id and x.ae_user_id is not null
  ),
  perso as (
    select r.id, r.name, a.ae_user_id
    from a join chat_room_members cm on cm.user_id = a.ae_user_id join chat_rooms r on r.id = cm.room_id
    where r.type = 'staff_room' and a.prenom is not null
      and (lower(r.name) = lower(a.nom_complet) or lower(r.name) like lower(a.prenom) || ' %' or lower(r.name) = lower(a.prenom))
    order by (lower(r.name) = lower(a.nom_complet)) desc, r.created_at
    limit 1
  ),
  grp as (
    select r.id, r.name, a.ae_user_id
    from a join chat_room_members cm on cm.user_id = a.ae_user_id join chat_rooms r on r.id = cm.room_id
    where r.type = 'manager_group'
    order by r.created_at
    limit 1
  )
  select id, name, ae_user_id from perso
  union all
  select id, name, ae_user_id from grp where not exists (select 1 from perso)
$$;
revoke all on function public.hub_salle_ae(uuid) from public, anon, authenticated;
grant execute on function public.hub_salle_ae(uuid) to service_role;

create or replace function public.hub_relance_poster(p_mission_id uuid, p_texte text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m mission_menage; s record; v_sender uuid; v_id uuid;
begin
  m := _terrain_check_bureau(p_mission_id);
  if length(trim(coalesce(p_texte, ''))) < 5 then raise exception 'message_vide'; end if;
  select * into s from hub_salle_ae(m.ae_id) limit 1;
  if s.room_id is null then raise exception 'conversation_staff_introuvable'; end if;
  v_sender := _chat_sender();
  if v_sender is null then raise exception 'acces_refuse'; end if;
  insert into chat_messages (room_id, sender_id, body) values (s.room_id, v_sender, trim(p_texte)) returning id into v_id;
  return jsonb_build_object('message_id', v_id, 'room_id', s.room_id, 'room_name', s.room_name, 'ae_user_id', s.ae_user_id, 'sender_id', v_sender);
end $$;
revoke all on function public.hub_relance_poster(uuid, text) from public, anon;
grant execute on function public.hub_relance_poster(uuid, text) to authenticated;


-- mission_historique (389) redéfinie : assigne_le d'initialisation ignoré.
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
    (nullif(ma.assigne_le, timestamptz '2026-10-09 11:21:43.04241+00'), 'attribution', 'assignee', 'Attribuée à ' || coalesce(a.prenom, '?') || case when ma.derniere_minute then ' (dernière minute)' else '' end, 'Hospitable'),
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

