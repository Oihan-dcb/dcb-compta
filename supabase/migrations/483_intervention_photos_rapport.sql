-- 483 — Ménage poussé / ménage de fond : photos AVANT / PENDANT / APRÈS par zone + rapport d'intervention
-- (19/10/2026, décisions Oïhan du 19/10, audit inventaire / ménage de fond).
--
-- Une « intervention » = une mission (mission_menage) qui porte un extra prévu « ménage poussé » (476) ou qui est
-- elle-même un ménage de fond (mission_terrain.type_terrain = 'demande_menage').
--
-- Photos : on RÉUTILISE la table prévue par 476 (mission_extra_prevu_photo) en l'élargissant :
--   * mission_id (obligatoire) : une mission de ménage de fond n'a pas d'extra → extra_id devient facultatif ;
--   * zone : piece_id (pièces de l'inventaire, inventaire_piece 481 : MÊME notion de pièce pour l'inventaire et le
--     ménage) + zone_nom (nom au moment de la photo, et zone libre si le bien n'a pas de fiche) ;
--   * bureau : retiree_rapport (photo écartée du rapport), ordre (ordre dans le rapport) ;
--   * supprimee_le : l'intervenante retire une photo ratée (pendant la mission).
--   Fichiers : bucket PRIVÉ tech-photos (chemin <ae.id>/intervention/<mission>/…), lus par URL signée
--   (portail : /api/tech-photo-url ; PowerHouse : api/intervention-rapport).
-- Écriture par l'intervenante UNIQUEMENT via les RPC ci-dessous (mission démarrée, la sienne) ; contrôle « photo
-- prise pendant la mission » côté portail (preuvePhoto.js, même règle que les preuves d'entretien).
--
-- Rapport : intervention_rapport (un par mission) — commentaires d'Oïhan par zone + synthèse, statut
--   a_relire → interne (gardé) | envoye (déposé dans l'espace propriétaire, owner_documents catégorie
--   'intervention'). Écriture uniquement par PowerHouse (api/intervention-rapport, service_role), jamais automatique.
--
-- Contrôle non bloquant : intervention_photo_anomalie() → « photos manquantes : Cuisine (après)… » ou
-- « ménage poussé sans photo » dans les anomalies du hub Missions (mission finie seulement), branché sur
-- mission_hub_periode par ancres (comme 482).

begin;

-- ── 1. Photos : élargissement de mission_extra_prevu_photo (476) ─────────────────────────────
alter table public.mission_extra_prevu_photo add column if not exists mission_id uuid references public.mission_menage(id) on delete cascade;
update public.mission_extra_prevu_photo p set mission_id = x.mission_id
  from public.mission_extra_prevu x where x.id = p.extra_id and p.mission_id is null;
alter table public.mission_extra_prevu_photo alter column mission_id set not null;
alter table public.mission_extra_prevu_photo alter column extra_id drop not null;
alter table public.mission_extra_prevu_photo add column if not exists piece_id uuid references public.inventaire_piece(id) on delete set null;
alter table public.mission_extra_prevu_photo add column if not exists zone_nom text;
alter table public.mission_extra_prevu_photo add column if not exists ordre integer not null default 0;
alter table public.mission_extra_prevu_photo add column if not exists retiree_rapport boolean not null default false;
alter table public.mission_extra_prevu_photo add column if not exists supprimee_le timestamptz;
alter table public.mission_extra_prevu_photo drop constraint if exists mission_extra_prevu_photo_zone_check;
alter table public.mission_extra_prevu_photo add constraint mission_extra_prevu_photo_zone_check
  check (piece_id is not null or length(trim(coalesce(zone_nom, ''))) between 1 and 60);
alter table public.mission_extra_prevu_photo drop constraint if exists mission_extra_prevu_photo_commentaire_check;
alter table public.mission_extra_prevu_photo add constraint mission_extra_prevu_photo_commentaire_check
  check (commentaire is null or length(commentaire) <= 500);
create index if not exists mission_extra_prevu_photo_mission_idx on public.mission_extra_prevu_photo (mission_id) where supprimee_le is null;
comment on table public.mission_extra_prevu_photo is
  'Photos d''intervention (476, élargie par 483) : ménage poussé (extra prévu) ou ménage de fond, par zone (piece_id = inventaire_piece, zone_nom) et par moment avant / pendant / après, commentaire de l''intervenante (interne, jamais dans le rapport propriétaire). Bucket privé tech-photos. Écriture AE via RPC intervention_photo_*.';

-- Lecture : bureau, ou l'AE de la mission. Plus d'insert direct (RPC).
drop policy if exists mission_extra_prevu_photo_select on public.mission_extra_prevu_photo;
create policy mission_extra_prevu_photo_select on public.mission_extra_prevu_photo for select to authenticated using (
  auth_user_is_staff()
  or exists (select 1 from public.mission_menage m where m.id = mission_extra_prevu_photo.mission_id and auth_user_owns_ae(m.ae_id))
);
drop policy if exists mission_extra_prevu_photo_insert on public.mission_extra_prevu_photo;
revoke insert, update, delete on public.mission_extra_prevu_photo from anon, authenticated;

-- ── 2. Est-ce une intervention avec photos ? ─────────────────────────────────────────────────
-- Extra « ménage poussé » non annulé (ni « pas fait ») OU mission de ménage de fond (demande_menage).
create or replace function public.intervention_photos_attendues(p_mission_id uuid, p_type_terrain text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_type_terrain, (select type_terrain from mission_terrain where mission_id = p_mission_id), '') = 'demande_menage'
      or exists (select 1 from mission_extra_prevu x where x.mission_id = p_mission_id and x.genre = 'menage_pousse' and x.statut in ('prevu', 'fait'))
$$;
revoke all on function public.intervention_photos_attendues(uuid, text) from public, anon;
grant execute on function public.intervention_photos_attendues(uuid, text) to authenticated;

-- Contrôle commun aux RPC de l'intervenante : sa mission, démarrée, pas terminée depuis plus de 2 h.
create or replace function public._intervention_check(p_mission_id uuid)
returns mission_menage language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null then raise exception 'mission_pas_en_cours'; end if;
  if t.ended_at is not null and t.ended_at < now() - interval '2 hours' then raise exception 'mission_terminee'; end if;
  if not intervention_photos_attendues(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
  return m;
end $$;
revoke all on function public._intervention_check(uuid) from public, anon, authenticated;

-- ── 3. Zones (= pièces de l'inventaire, 481) ─────────────────────────────────────────────────
-- Renvoie les pièces actives du bien, générées au besoin (même génération que l'inventaire). Bien sans fiche
-- (bien_toolbox) : liste vide → le portail propose des zones libres (zone_nom).
create or replace function public.intervention_zones(p_mission_id uuid)
returns table (id uuid, nom text, genre text, ordre integer)
language plpgsql security definer set search_path = public as $$
declare m mission_menage; v_tbx uuid;
begin
  m := _terrain_mission_check(p_mission_id);
  select bt.id into v_tbx from bien_toolbox bt where bt.bien_id = m.bien_id order by (bt.archived_at is null) desc limit 1;
  if v_tbx is null then return; end if;
  if not exists (select 1 from inventaire_piece p where p.bien_id = v_tbx and p.actif) then perform _inventaire_pieces_generer(v_tbx); end if;
  return query select p.id, p.nom, p.genre, p.ordre from inventaire_piece p where p.bien_id = v_tbx and p.actif order by p.ordre, p.nom;
end $$;
revoke all on function public.intervention_zones(uuid) from public, anon;
grant execute on function public.intervention_zones(uuid) to authenticated;

-- Ajouter une zone sur place : devient une pièce du bien (source intervenant), réutilisée par l'inventaire.
create or replace function public.intervention_zone_ajouter(p_mission_id uuid, p_nom text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m mission_menage; v_tbx uuid; v uuid; n text := left(trim(coalesce(p_nom, '')), 60);
begin
  m := _intervention_check(p_mission_id);
  if length(n) < 1 then raise exception 'nom_obligatoire'; end if;
  select bt.id into v_tbx from bien_toolbox bt where bt.bien_id = m.bien_id order by (bt.archived_at is null) desc limit 1;
  if v_tbx is null then return null; end if;   -- pas de fiche : zone libre (zone_nom) côté portail
  select p.id into v from inventaire_piece p where p.bien_id = v_tbx and p.actif and lower(p.nom) = lower(n) limit 1;
  if v is not null then return v; end if;
  insert into inventaire_piece (bien_id, nom, genre, ordre, source, cree_par_ae_id)
  values (v_tbx, n,
          case when n ~* '(chambre|suite)' then 'chambre' when n ~* '(bain|douche)' then 'salle_de_bain' when n ~* '^wc' then 'wc'
               when n ~* 'cuisine' then 'cuisine' when n ~* '(terrasse|jardin|balcon|ext[ée]rieur|piscine)' then 'exterieur' else 'autre' end,
          coalesce((select max(p.ordre) from inventaire_piece p where p.bien_id = v_tbx and p.actif), 0) + 10, 'intervenant', m.ae_id)
  returning id into v;
  return v;
end $$;
revoke all on function public.intervention_zone_ajouter(uuid, text) from public, anon;
grant execute on function public.intervention_zone_ajouter(uuid, text) to authenticated;

-- ── 4. Photos : ajouter / commenter / retirer (intervenante) ─────────────────────────────────
create or replace function public.intervention_photo_ajouter(
  p_mission_id uuid, p_moment text, p_url text, p_storage_path text, p_piece_id uuid default null,
  p_zone_nom text default null, p_commentaire text default null, p_prise_le timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m mission_menage; v uuid; v_extra uuid; v_nom text;
begin
  m := _intervention_check(p_mission_id);
  if p_moment not in ('avant', 'pendant', 'apres') then raise exception 'moment_invalide'; end if;
  if coalesce(p_storage_path, '') !~ ('^' || m.ae_id::text || '/intervention/') then raise exception 'chemin_invalide'; end if;
  if p_piece_id is not null then
    select p.nom into v_nom from inventaire_piece p join bien_toolbox bt on bt.id = p.bien_id where p.id = p_piece_id and bt.bien_id = m.bien_id;
    if v_nom is null then raise exception 'zone_hors_bien'; end if;
  else
    v_nom := left(trim(coalesce(p_zone_nom, '')), 60);
    if length(v_nom) < 1 then raise exception 'zone_obligatoire'; end if;
  end if;
  select x.id into v_extra from mission_extra_prevu x where x.mission_id = m.id and x.genre = 'menage_pousse' and x.statut in ('prevu', 'fait') order by x.created_at limit 1;
  insert into mission_extra_prevu_photo (extra_id, mission_id, moment, url, storage_path, commentaire, prise_le, ae_id, piece_id, zone_nom, ordre)
  values (v_extra, m.id, p_moment, p_url, p_storage_path, nullif(left(trim(coalesce(p_commentaire, '')), 500), ''), coalesce(p_prise_le, now()), m.ae_id,
          p_piece_id, v_nom,
          coalesce((select max(f.ordre) from mission_extra_prevu_photo f where f.mission_id = m.id and f.moment = p_moment), 0) + 10)
  returning id into v;
  return v;
end $$;
revoke all on function public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz) to authenticated;

create or replace function public.intervention_photo_modifier(p_photo_id uuid, p_commentaire text default null, p_retirer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare f mission_extra_prevu_photo;
begin
  select * into f from mission_extra_prevu_photo where id = p_photo_id and supprimee_le is null for update;
  if not found then raise exception 'photo_introuvable'; end if;
  perform _intervention_check(f.mission_id);
  if p_retirer then
    update mission_extra_prevu_photo set supprimee_le = now() where id = f.id;
  else
    update mission_extra_prevu_photo set commentaire = nullif(left(trim(coalesce(p_commentaire, '')), 500), '') where id = f.id;
  end if;
end $$;
revoke all on function public.intervention_photo_modifier(uuid, text, boolean) from public, anon;
grant execute on function public.intervention_photo_modifier(uuid, text, boolean) to authenticated;

-- ── 5. Point de vérification (non bloquant) ──────────────────────────────────────────────────
-- null si la mission n'attend pas de photos ; sinon « ménage poussé sans photo » / « ménage de fond sans photo »
-- ou « photos manquantes : Cuisine (après), Séjour (avant) » pour chaque zone photographiée à qui il manque
-- l'avant ou l'après.
create or replace function public.intervention_photo_anomalie(p_mission_id uuid, p_type_terrain text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_manques text; v_nb int; v_lib text;
begin
  if not intervention_photos_attendues(p_mission_id, p_type_terrain) then return null; end if;
  -- outil livré le 19/10/2026 : pas de signalement rétroactif des ménages de fond plus anciens
  if (select date_mission from mission_menage where id = p_mission_id) < date '2026-10-19' then return null; end if;
  v_lib := case when coalesce(p_type_terrain, '') = 'demande_menage' then 'ménage de fond' else 'ménage poussé' end;
  select count(*) into v_nb from mission_extra_prevu_photo where mission_id = p_mission_id and supprimee_le is null;
  if v_nb = 0 then return v_lib || ' sans photo avant / après'; end if;
  select string_agg(z.nom || ' (' || case when not z.a_avant and not z.a_apres then 'ni avant ni après' when not z.a_avant then 'pas d''avant' else 'pas d''après' end || ')', ', ' order by z.nom)
    into v_manques
    from (select coalesce(max(zone_nom), 'Zone') as nom, bool_or(moment = 'avant') a_avant, bool_or(moment = 'apres') a_apres
            from mission_extra_prevu_photo where mission_id = p_mission_id and supprimee_le is null
           group by coalesce(piece_id::text, 'libre:' || lower(trim(zone_nom)))) z
   where not (z.a_avant and z.a_apres);
  if v_manques is null then return null; end if;
  return 'photos ' || v_lib || ' incomplètes : ' || v_manques;
end $$;
revoke all on function public.intervention_photo_anomalie(uuid, text) from public, anon;
grant execute on function public.intervention_photo_anomalie(uuid, text) to authenticated;

-- ── 6. Rapport d'intervention (bureau) ───────────────────────────────────────────────────────
create table if not exists public.intervention_rapport (
  mission_id uuid primary key references public.mission_menage(id) on delete cascade,
  statut text not null default 'a_relire' check (statut in ('a_relire', 'interne', 'envoye')),
  synthese text check (synthese is null or length(synthese) <= 4000),
  commentaires_zones jsonb not null default '{}'::jsonb,   -- { "<piece_id> | libre:<nom>": "commentaire d'Oïhan" }
  owner_document_id uuid,
  envoye_le timestamptz,
  envoye_par_nom text,
  modifie_par_nom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.intervention_rapport is
  'Rapport d''intervention (483) relu par le bureau : commentaires d''Oïhan par zone + synthèse ; statut a_relire / interne / envoye (owner_documents catégorie intervention). Seuls les commentaires du bureau vont au propriétaire, jamais ceux ni le nom de l''intervenante. Écrit uniquement par PowerHouse (service_role), jamais automatiquement.';
alter table public.intervention_rapport enable row level security;
drop policy if exists intervention_rapport_lecture on public.intervention_rapport;
create policy intervention_rapport_lecture on public.intervention_rapport for select to authenticated using (auth_user_is_staff());
revoke insert, update, delete on public.intervention_rapport from anon, authenticated;

-- ── 7. Espace propriétaire : catégorie de document « intervention » ──────────────────────────
alter table public.owner_documents drop constraint if exists owner_documents_categorie_check;
alter table public.owner_documents add constraint owner_documents_categorie_check check (categorie = any (array[
  'mandat', 'facture', 'releve', 'diagnostic', 'contrat', 'attestation', 'inventaire', 'photo', 'autre', 'intervention']));

commit;

-- ── 8. Hub Missions : anomalie branchée par ancres (comme 482, sans recopier le corps) ───────
-- ⚠ Toute redéfinition future de mission_hub_periode doit garder ces deux lignes (repère : « 483 »).
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.mission_hub_periode(date, date, timestamptz)'::regprocedure);
  if position('photos_anom' in d) > 0 then return; end if;  -- déjà branché
  d2 := replace(d, ' as inventaire_anom,',
    E' as inventaire_anom,\n    -- 483 : photos avant / après par zone (ménage poussé, ménage de fond)\n    public.intervention_photo_anomalie(m.id, t.type_terrain) as photos_anom,');
  if d2 = d then raise exception '483 : ancre inventaire_anom introuvable'; end if;
  d := d2;
  d2 := replace(d, 'case when base.ended_at is not null then base.inventaire_anom end',
    E'case when base.ended_at is not null then base.inventaire_anom end,\n      -- 483 : photos d''intervention (mission finie seulement)\n      case when base.ended_at is not null then base.photos_anom end');
  if d2 = d then raise exception '483 : ancre anomalie inventaire introuvable'; end if;
  execute d2;
end $mig$;
