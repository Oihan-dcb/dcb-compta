-- 398 — Calendrier PowerHouse : synchro stable (upsert + diff transactionnel) et tarifs stockés en base
-- (10/10/2026, décision Oïhan « ok pour 1 à 5 », Lot 0 de la proposition Calendrier).
--
-- AVANT : sync-ical-planning faisait, bien par bien et SANS transaction, un DELETE de tous les spans de la
-- fenêtre puis un INSERT (9,0 M insertions / 7,25 M suppressions cumulées pour ~4 300 lignes vivantes).
-- Chaque blocage changeait d'id toutes les 5 min, et une lecture tombant entre le DELETE et l'INSERT voyait
-- le bien vide. Les tarifs, eux, étaient relus en direct chez Hospitable par CHAQUE navigateur ouvert
-- (api/dispo-pricing.js, ~24 appels / 5 min / onglet) puis vidés à chaque rafraîchissement.
--
-- APRÈS :
--   * calendrier_sync_bien(...) : une seule transaction par bien (verrou consultatif), upsert sur
--     (bien_id, uid_cal) qui n'écrit QUE ce qui a changé, suppression des seuls spans disparus. Les ids
--     restent stables ; un span tronqué par le bord gauche de la fenêtre (séjour commencé avant J-14) garde
--     son vrai début au lieu de changer d'uid chaque jour.
--   * calendrier_jour : le calendrier Hospitable du jour (prix, séjour minimum, fermetures arrivée/départ,
--     note), même appel API que la synchro (aucun appel en plus), mis à jour par diff.
--   * calendrier_sync_bien_etat : fraîcheur par bien (la fraîcheur ne se lit plus dans derniere_sync, qui
--     n'avance désormais que quand le span change).
--   * calendrier_tarifs(...) : lecture compacte pour la grille (RLS appliquée : security invoker).
-- Consommateurs de property_calendar inchangés (ical-dispo, portail owner, owner_calendar, GA, dispo-action) :
-- mêmes colonnes, mêmes conventions (date_fin exclusive, uid_cal = bien_id:date_debut).

-- ── Tables ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists calendrier_jour (
  bien_id        uuid not null references bien(id) on delete cascade,
  jour           date not null,
  dispo          boolean not null,
  prix_centimes  integer,
  devise         text,
  min_nuits      integer,
  ferme_arrivee  boolean not null default false,
  ferme_depart   boolean not null default false,
  note           text,
  raison         text,
  maj_le         timestamptz not null default now(),
  primary key (bien_id, jour)
);
comment on table calendrier_jour is 'Calendrier Hospitable par bien et par jour (prix, séjour minimum, fermetures), alimenté par sync-ical-planning (diff, migration 398). Lecture : calendrier_tarifs().';

create table if not exists calendrier_sync_bien_etat (
  bien_id          uuid primary key references bien(id) on delete cascade,
  synchro_le       timestamptz not null default now(),
  ok               boolean not null default true,
  erreur           text,
  nb_spans         integer,
  nb_jours         integer,
  spans_inseres    integer,
  spans_modifies   integer,
  spans_supprimes  integer,
  jours_modifies   integer
);
comment on table calendrier_sync_bien_etat is 'Dernier passage de sync-ical-planning par bien (fraîcheur affichée dans le Calendrier PowerHouse), migration 398.';

alter table calendrier_jour enable row level security;
alter table calendrier_sync_bien_etat enable row level security;

drop policy if exists calendrier_jour_lecture_staff on calendrier_jour;
create policy calendrier_jour_lecture_staff on calendrier_jour for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
drop policy if exists calendrier_sync_etat_lecture_staff on calendrier_sync_bien_etat;
create policy calendrier_sync_etat_lecture_staff on calendrier_sync_bien_etat for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- ── Synchro d'un bien : une transaction, écrit seulement la différence ────────────────────────────
-- p_spans : [{date_debut, date_fin (exclusive), source, titre}]
-- p_jours : [{jour, dispo, prix, devise, min, ci, co, note, raison}]
create or replace function calendrier_sync_bien(p_bien_id uuid, p_debut date, p_fin date, p_spans jsonb, p_jours jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_spans jsonb;
  v_uids text[];
  v_ins int := 0; v_upd int := 0; v_del int := 0; v_jours int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('calendrier_sync:' || p_bien_id::text));

  -- Spans entrants ; un span qui commence au bord gauche de la fenêtre reprend le début réel du span
  -- existant de même source qui le recouvre (sinon son uid changerait tous les jours).
  select coalesce(jsonb_agg(jsonb_build_object('d', x.d, 'f', x.f, 'src', x.src, 'titre', x.titre)), '[]'::jsonb),
         coalesce(array_agg(p_bien_id::text || ':' || x.d::text), '{}')
    into v_spans, v_uids
  from (
    select coalesce(
             (select pc.date_debut from property_calendar pc
               where pc.bien_id = p_bien_id and i.d = p_debut and pc.date_debut < p_debut
                 and pc.date_fin > p_debut and pc.source = i.src
               order by pc.date_debut desc limit 1),
             i.d) as d, i.f, i.src, i.titre
    from (select (s->>'date_debut')::date d, (s->>'date_fin')::date f, coalesce(s->>'source','direct') src,
                 nullif(s->>'titre','') titre
            from jsonb_array_elements(coalesce(p_spans, '[]'::jsonb)) s) i
  ) x;

  with up as (
    insert into property_calendar (bien_id, uid_cal, source, date_debut, date_fin, titre, statut, derniere_sync)
    select p_bien_id, p_bien_id::text || ':' || (e->>'d'), e->>'src', (e->>'d')::date, (e->>'f')::date, e->>'titre', 'confirmed', v_now
      from jsonb_array_elements(v_spans) e
    on conflict (bien_id, uid_cal) do update
      set source = excluded.source, date_debut = excluded.date_debut, date_fin = excluded.date_fin,
          titre = excluded.titre, statut = 'confirmed', derniere_sync = excluded.derniere_sync
      where (property_calendar.source, property_calendar.date_fin, property_calendar.titre, property_calendar.statut)
            is distinct from (excluded.source, excluded.date_fin, excluded.titre, 'confirmed')
    returning (xmax = 0) as nouveau
  )
  select count(*) filter (where nouveau), count(*) filter (where not nouveau) into v_ins, v_upd from up;

  -- Seuls les spans disparus de Hospitable (dans la fenêtre) sont supprimés ; le passé hors fenêtre reste.
  delete from property_calendar pc
   where pc.bien_id = p_bien_id and pc.date_debut < p_fin and pc.date_fin > p_debut
     and not (pc.uid_cal = any(v_uids));
  get diagnostics v_del = row_count;

  -- Jours (tarifs / règles) : diff
  if p_jours is not null and jsonb_array_length(p_jours) > 0 then
    with up as (
      insert into calendrier_jour (bien_id, jour, dispo, prix_centimes, devise, min_nuits, ferme_arrivee, ferme_depart, note, raison, maj_le)
      select p_bien_id, j.jour, coalesce(j.dispo, false), j.prix, j.devise, j.min, coalesce(j.ci, false), coalesce(j.co, false), nullif(j.note,''), nullif(j.raison,''), v_now
        from jsonb_to_recordset(p_jours) as j(jour date, dispo boolean, prix integer, devise text, min integer, ci boolean, co boolean, note text, raison text)
       where j.jour is not null
      on conflict (bien_id, jour) do update
        set dispo = excluded.dispo, prix_centimes = excluded.prix_centimes, devise = excluded.devise, min_nuits = excluded.min_nuits,
            ferme_arrivee = excluded.ferme_arrivee, ferme_depart = excluded.ferme_depart, note = excluded.note, raison = excluded.raison,
            maj_le = excluded.maj_le
        where (calendrier_jour.dispo, calendrier_jour.prix_centimes, calendrier_jour.devise, calendrier_jour.min_nuits,
               calendrier_jour.ferme_arrivee, calendrier_jour.ferme_depart, calendrier_jour.note, calendrier_jour.raison)
              is distinct from
              (excluded.dispo, excluded.prix_centimes, excluded.devise, excluded.min_nuits,
               excluded.ferme_arrivee, excluded.ferme_depart, excluded.note, excluded.raison)
      returning 1
    )
    select count(*) into v_jours from up;
    delete from calendrier_jour where bien_id = p_bien_id and jour < p_debut;
  end if;

  insert into calendrier_sync_bien_etat (bien_id, synchro_le, ok, erreur, nb_spans, nb_jours, spans_inseres, spans_modifies, spans_supprimes, jours_modifies)
  values (p_bien_id, v_now, true, null, jsonb_array_length(v_spans), coalesce(jsonb_array_length(p_jours), 0), v_ins, v_upd, v_del, v_jours)
  on conflict (bien_id) do update set synchro_le = excluded.synchro_le, ok = true, erreur = null, nb_spans = excluded.nb_spans,
    nb_jours = excluded.nb_jours, spans_inseres = excluded.spans_inseres, spans_modifies = excluded.spans_modifies,
    spans_supprimes = excluded.spans_supprimes, jours_modifies = excluded.jours_modifies;

  return jsonb_build_object('inseres', v_ins, 'modifies', v_upd, 'supprimes', v_del, 'jours_modifies', v_jours);
end;
$$;

-- Échec d'un bien : on garde ses données (pas de vidage), on note l'erreur.
create or replace function calendrier_sync_bien_erreur(p_bien_id uuid, p_erreur text)
returns void language sql set search_path = public as $$
  insert into calendrier_sync_bien_etat (bien_id, synchro_le, ok, erreur)
  values (p_bien_id, now(), false, left(p_erreur, 500))
  on conflict (bien_id) do update set ok = false, erreur = excluded.erreur;
$$;

revoke all on function calendrier_sync_bien(uuid, date, date, jsonb, jsonb) from public, anon, authenticated;
revoke all on function calendrier_sync_bien_erreur(uuid, text) from public, anon, authenticated;
grant execute on function calendrier_sync_bien(uuid, date, date, jsonb, jsonb) to service_role;
grant execute on function calendrier_sync_bien_erreur(uuid, text) to service_role;

-- ── Lecture compacte pour la grille (RLS du lecteur) ──────────────────────────────────────────────
-- { debut, biens: { <bien_id>: { p:[euros|null], m:[min|null], f:[bits], n:{<index>:note} } },
--   sync: { <bien_id>: { at, ok, err } } }   f : 1 = disponible, 2 = fermé à l'arrivée, 4 = fermé au départ
create or replace function calendrier_tarifs(p_debut date, p_fin date, p_bien_ids uuid[] default null)
returns jsonb
language sql stable
security invoker
set search_path = public
as $$
  with j as (
    select cj.bien_id, (cj.jour - p_debut) as i, cj.prix_centimes, cj.min_nuits, cj.dispo, cj.ferme_arrivee, cj.ferme_depart, cj.note
      from calendrier_jour cj
     where cj.jour >= p_debut and cj.jour < p_fin and (p_bien_ids is null or cj.bien_id = any(p_bien_ids))
  ), b as (
    select bien_id, jsonb_build_object(
      'p', jsonb_agg(case when prix_centimes is null then null else round(prix_centimes / 100.0)::int end order by i),
      'm', jsonb_agg(min_nuits order by i),
      'f', jsonb_agg((case when dispo then 1 else 0 end) + (case when ferme_arrivee then 2 else 0 end) + (case when ferme_depart then 4 else 0 end) order by i),
      'i', jsonb_agg(i order by i),
      'n', coalesce(jsonb_object_agg(i::text, note) filter (where note is not null), '{}'::jsonb)
    ) o
    from j group by bien_id
  )
  select jsonb_build_object(
    'debut', p_debut,
    'biens', coalesce((select jsonb_object_agg(bien_id::text, o) from b), '{}'::jsonb),
    'sync', coalesce((select jsonb_object_agg(e.bien_id::text, jsonb_build_object('at', e.synchro_le, 'ok', e.ok, 'err', e.erreur))
                        from calendrier_sync_bien_etat e where p_bien_ids is null or e.bien_id = any(p_bien_ids)), '{}'::jsonb)
  );
$$;
revoke all on function calendrier_tarifs(date, date, uuid[]) from public, anon;
grant execute on function calendrier_tarifs(date, date, uuid[]) to authenticated, service_role;
