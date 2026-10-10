-- 393 — Notifications du hub des tâches (10/10/2026, audit ⚙ › 🔔 Notifications, corrections validées par Oïhan).
--
-- 1. Période de calme : une notification qui tombait pendant le calme d'un AE (ou d'un validateur) était
--    PERDUE (sauf message de conversation), et les crons la notaient « envoyée ». Désormais push-ga (portail AE)
--    la met en file (push_pending, comme les messages de chat) et cron-flush-quiet l'envoie à la fin du calme
--    (seule s'il n'y en a qu'une, sinon un résumé). Les crons ne notent « envoyé » que si au moins un appareil
--    l'a reçue ; sinon « calme » (en attente) ou « aucun_appareil ».
--      push_pending : + kind ('chat' | 'notif'), title, url, tag, ref (ce qu'il faut marquer « envoyé » à la
--                     livraison) ; unique (user_id, tag) → une notification réessayée n'est mise en file qu'une fois.
--      mission_acceptation : + notif_ae_etat, rappel_ae_etat, alerte_bureau_etat, refus_notifie_etat.
--      terrain_rappel : + etat.
--      push_pending_livrer(ids, etat) : appelée par cron-flush-quiet après l'envoi (service_role seul).
-- 2. « À reprendre » : le message part dans la conversation de l'AE choisie par la règle 377 (hub_salle_ae :
--    salle à son nom, sinon son groupe Managers — avant : ancienne règle _terrain_room_staff) ; un seul message
--    par mission et par jour (mission_terrain.reprendre_msg_id / reprendre_msg_le) : l'endpoint mission-hub
--    n'envoie la notification que si un NOUVEAU message est parti.
--    _terrain_room_staff (💬 Message staff, retours vidéo) suit la même règle.
-- 3. mission_historique : libellés « en attente (période de calme) » / « non reçue (aucun appareil) ».

alter table public.push_pending
  add column if not exists kind text not null default 'chat',
  add column if not exists title text,
  add column if not exists url text,
  add column if not exists tag text,
  add column if not exists ref jsonb;
create unique index if not exists push_pending_user_tag_uniq on public.push_pending (user_id, tag);

alter table public.mission_acceptation
  add column if not exists notif_ae_etat text check (notif_ae_etat in ('envoye', 'calme', 'aucun_appareil')),
  add column if not exists rappel_ae_etat text check (rappel_ae_etat in ('envoye', 'calme', 'aucun_appareil')),
  add column if not exists alerte_bureau_etat text check (alerte_bureau_etat in ('envoye', 'calme', 'aucun_appareil')),
  add column if not exists refus_notifie_etat text check (refus_notifie_etat in ('envoye', 'calme', 'aucun_appareil'));

alter table public.terrain_rappel
  add column if not exists etat text not null default 'envoye' check (etat in ('envoye', 'calme', 'aucun_appareil'));

alter table public.mission_terrain
  add column if not exists reprendre_msg_id uuid,
  add column if not exists reprendre_msg_le timestamptz;

-- Livraison d'une notification mise en file : marque ce qu'elle concernait.
create or replace function public.push_pending_livrer(p_ids uuid[], p_etat text)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_col text; v_ids uuid[];
begin
  if p_etat not in ('envoye', 'aucun_appareil') then raise exception 'etat_invalide'; end if;
  for r in select ref from push_pending where id = any (p_ids) and ref is not null loop
    if r.ref ->> 't' = 'mission_acceptation' and r.ref ->> 'col' in ('notif_ae', 'rappel_ae', 'alerte_bureau', 'refus_notifie') then
      v_col := (r.ref ->> 'col') || '_etat';
      select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(coalesce(r.ref -> 'ids', '[]'::jsonb)) x;
      if v_ids is null then continue; end if;
      execute format('update mission_acceptation set %I = $1, updated_at = now()%s where id = any ($2) and coalesce(%I, '''') <> ''envoye''',
                     v_col,
                     case when r.ref ->> 'col' = 'refus_notifie' and p_etat = 'envoye' then ', refus_notifie_le = coalesce(refus_notifie_le, now())' else '' end,
                     v_col)
        using p_etat, v_ids;
      n := n + 1;
    elsif r.ref ->> 't' = 'terrain_rappel' then
      update terrain_rappel tr set etat = p_etat
        from jsonb_array_elements(coalesce(r.ref -> 'rows', '[]'::jsonb)) x
       where tr.mission_id = (x ->> 'm')::uuid and tr.type = x ->> 'type' and tr.etat <> 'envoye';
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.push_pending_livrer(uuid[], text) from public, anon, authenticated;
grant execute on function public.push_pending_livrer(uuid[], text) to service_role;

-- Conversation de l'AE pour 💬 Message staff / retours vidéo / « À reprendre » : règle 377 (hub_salle_ae).
create or replace function public._terrain_room_staff(p_ae_id uuid)
 returns uuid language sql stable security definer set search_path to 'public' as $$
  select room_id from public.hub_salle_ae(p_ae_id) limit 1
$$;
revoke all on function public._terrain_room_staff(uuid) from public, anon, authenticated;

create or replace function public.terrain_controle_bureau(p_mission_id uuid, p_statut text, p_note text default null)
 returns mission_terrain language plpgsql security definer set search_path to 'public' as $function$
declare m mission_menage; t mission_terrain; v_room uuid; v_bien text; v_id uuid;
begin
  m := _terrain_check_bureau(p_mission_id);
  if p_statut is not null and p_statut not in ('ok', 'a_reprendre') then raise exception 'statut_invalide'; end if;
  if p_statut = 'a_reprendre' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'note_obligatoire'; end if;
  update mission_terrain set controle_statut = p_statut, controle_note = nullif(trim(coalesce(p_note, '')), ''),
         controle_par = case when p_statut is null then null else auth.uid() end,
         controle_at = case when p_statut is null then null else now() end, updated_at = now()
   where mission_id = p_mission_id returning * into t;
  if not found then raise exception 'mission_non_demarree'; end if;
  -- Un seul message « À reprendre » par mission et par jour (heure de Paris).
  if p_statut = 'a_reprendre'
     and (t.reprendre_msg_le is null
          or (t.reprendre_msg_le at time zone 'Europe/Paris')::date <> (now() at time zone 'Europe/Paris')::date) then
    v_room := _terrain_room_staff(m.ae_id);
    if v_room is null then raise exception 'conversation_staff_introuvable'; end if;
    select coalesce(code, hospitable_name) into v_bien from bien where id = m.bien_id;
    insert into chat_messages (room_id, sender_id, body)
    values (v_room, _chat_sender(), '📍 ' || coalesce(v_bien, 'Mission') || ' (' || to_char(m.date_mission, 'DD/MM') || ') — ⚠️ À reprendre : ' || trim(p_note))
    returning id into v_id;
    update mission_terrain set reprendre_msg_id = v_id, reprendre_msg_le = now() where mission_id = p_mission_id returning * into t;
  end if;
  return t;
end $function$;
revoke all on function public.terrain_controle_bureau(uuid, text, text) from public, anon;
grant execute on function public.terrain_controle_bureau(uuid, text, text) to authenticated;

-- mission_historique (390) redéfinie : état réel des notifications automatiques.
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
    (ma.notif_ae_le, 'rappels', 'notif_ae', 'Notification « mission à confirmer » ' || case when ma.notif_ae_etat in ('calme', 'aucun_appareil') then 'pour ' else 'envoyée à ' end || coalesce(a.prenom, '?') || case ma.notif_ae_etat when 'calme' then ' — en attente (période de calme), partira à la fin du calme' when 'aucun_appareil' then ' — non reçue (aucun appareil abonné aux notifications)' else '' end, 'automatique'),
    (ma.rappel_ae_le, 'rappels', 'rappel_ae', 'Rappel ' || case when ma.rappel_ae_etat in ('calme', 'aucun_appareil') then 'pour ' else 'envoyé à ' end || coalesce(a.prenom, '?') || ' : toujours pas de réponse' || case ma.rappel_ae_etat when 'calme' then ' — en attente (période de calme), partira à la fin du calme' when 'aucun_appareil' then ' — non reçue (aucun appareil abonné aux notifications)' else '' end, 'automatique'),
    (ma.alerte_bureau_le, 'rappels', 'alerte_bureau', 'Alerte au bureau : ' || coalesce(a.prenom, '?') || ' n''a pas répondu à l''échéance' || case ma.alerte_bureau_etat when 'calme' then ' — en attente (période de calme), partira à la fin du calme' when 'aucun_appareil' then ' — non reçue (aucun appareil abonné aux notifications)' else '' end, 'automatique'),
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
                     else 'Rappel ' || r.type || ' à ' || coalesce(a.prenom, '?') end
         || case r.etat when 'calme' then ' — en attente (période de calme), partira à la fin du calme'
                        when 'aucun_appareil' then ' — non reçu (aucun appareil abonné aux notifications)' else '' end,
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

