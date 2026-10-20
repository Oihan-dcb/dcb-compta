-- 514 — Photos manquantes des guides d'arrivée prises par l'équipe pendant les ménages (20/10/2026, accord d'Oïhan :
-- « oui très bonne idée les tâches terrain »).
--
-- Mécanisme = celui du hub Missions : un EXTRA PRÉVU (476) sur la prochaine mission ménage du bien, fait par
-- l'intervenant de la mission, visible dans « Ma journée » (portail AE). Nouveau genre « photos_arrivee » :
--   * photos_demandees = liste des photos à prendre [{cle, libelle, cibles:[{bien_id, bien_code, etape_id}]}] ;
--     une photo peut servir plusieurs biens (ex. façade de la Maison Maïté pour la maison et ses 5 chambres).
--   * l'intervenant dépose chaque photo dans la mission (même circuit que les photos d'intervention 483/485 :
--     bucket PRIVÉ tech-photos, file hors réseau, contrôle « prise pendant la mission ») ; la photo garde la clé
--     de la demande (mission_extra_prevu_photo.demande_cle).
--   * PowerHouse (fiche bien › 🗝 Arrivée) propose ces photos à placer d'un clic sur l'étape ; la copie publique
--     passe par le contrôle « code visible ? » existant (bien_arrivee_photo, 502).
-- Payé comme un extra prévu (durée réelle, validation bureau), imputation DCB (dcb_direct), jamais refacturé.
--
-- Demande au niveau du bien (arrivee_photo_demande) : rattachée automatiquement à la prochaine mission ménage
-- (checkout / recouche, AE attribué, pas démarrée, dans les 30 jours) par arrivee_photo_planifier() (pg_cron toutes
-- les 2 h). Sans mission : reste « à planifier » et se rattache dès qu'une mission apparaît. Extra annulé / « pas pu
-- le faire » / mission annulée → la demande repart « à planifier ». Aucune notification propre (comme tout extra
-- prévu) : l'intervenant le voit dans Ma journée.

begin;

-- ── 1. Type de prestation ────────────────────────────────────────────────────────────────────
insert into public.prestation_type (nom, description, taux_defaut, unite, actif, type_imputation_defaut)
select 'Photos guide d''arrivée', 'Photos pour le guide d''arrivée des voyageurs (extra prévu, payé par DCB)', 2500, 'heure', true, 'dcb_direct'
where not exists (select 1 from public.prestation_type where lower(trim(nom)) = lower('Photos guide d''arrivée'));

-- ── 2. Extra prévu : genre + liste des photos ────────────────────────────────────────────────
alter table public.mission_extra_prevu drop constraint if exists mission_extra_prevu_genre_check;
alter table public.mission_extra_prevu add constraint mission_extra_prevu_genre_check
  check (genre in ('menage_pousse', 'inventaire', 'autre', 'photos_arrivee'));
alter table public.mission_extra_prevu add column if not exists photos_demandees jsonb;
comment on column public.mission_extra_prevu.photos_demandees is
  'Genre photos_arrivee (514) : [{cle, libelle, cibles:[{bien_id, bien_code, etape_id}]}] — photos à prendre pour les guides d''arrivée.';

alter table public.mission_extra_prevu_photo add column if not exists demande_cle text;
comment on column public.mission_extra_prevu_photo.demande_cle is
  'Photo de guide d''arrivée (514) : clé de la photo demandée dans mission_extra_prevu.photos_demandees (extra_id = l''extra photos_arrivee). Null = photo d''intervention.';
create index if not exists mission_extra_prevu_photo_demande_idx on public.mission_extra_prevu_photo (extra_id) where demande_cle is not null;

-- ── 3. Photos acceptées sur la mission : intervention (483) OU photos de guide d'arrivée ─────
create or replace function public.intervention_photos_permises(p_mission_id uuid, p_type_terrain text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select intervention_photos_attendues(p_mission_id, p_type_terrain)
      or exists (select 1 from mission_extra_prevu x where x.mission_id = p_mission_id and x.genre = 'photos_arrivee' and x.statut in ('prevu', 'fait'))
$$;
revoke all on function public.intervention_photos_permises(uuid, text) from public, anon;
grant execute on function public.intervention_photos_permises(uuid, text) to authenticated;

create or replace function public._intervention_check(p_mission_id uuid)
returns mission_menage language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null then raise exception 'mission_pas_en_cours'; end if;
  if t.ended_at is not null and t.ended_at < now() - interval '2 hours' then raise exception 'mission_terminee'; end if;
  if not intervention_photos_permises(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
  return m;
end $$;
revoke all on function public._intervention_check(uuid) from public, anon, authenticated;

-- Zone « arrivee:<clé> » (portail, bloc 📸 Photos pour le guide) → photo rattachée à l'extra photos_arrivee et à la
-- photo demandée ; zone_nom = libellé lisible. Le reste est inchangé (485).
create or replace function public.intervention_photo_ajouter(
  p_mission_id uuid, p_moment text, p_url text, p_storage_path text, p_piece_id uuid default null,
  p_zone_nom text default null, p_commentaire text default null, p_prise_le timestamptz default null,
  p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m mission_menage; t mission_terrain; v uuid; v_extra uuid; v_nom text; v_cle text;
begin
  m := _terrain_mission_check(p_mission_id);

  if p_client_id is not null then
    select f.id into v from mission_extra_prevu_photo f where f.client_id = p_client_id and f.mission_id = m.id;
    if v is not null then return v; end if;
  end if;

  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null then raise exception 'mission_pas_en_cours'; end if;
  if not intervention_photos_permises(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
  if t.ended_at is not null and t.ended_at < now() - interval '2 hours' then
    if p_prise_le is null
       or p_prise_le < t.started_at - interval '10 minutes'
       or p_prise_le > t.ended_at + interval '2 hours'
       or t.ended_at < now() - interval '14 days' then
      raise exception 'mission_terminee';
    end if;
  end if;
  if p_prise_le is not null and p_prise_le < t.started_at - interval '10 minutes' then raise exception 'photo_avant_mission'; end if;

  if p_moment not in ('avant', 'pendant', 'apres') then raise exception 'moment_invalide'; end if;
  if coalesce(p_storage_path, '') !~ ('^' || m.ae_id::text || '/intervention/') then raise exception 'chemin_invalide'; end if;

  if p_piece_id is null and coalesce(p_zone_nom, '') ~ '^arrivee:' then
    v_cle := substr(p_zone_nom, 9);
    select x.id, left(coalesce((select d->>'libelle' from jsonb_array_elements(x.photos_demandees) d where d->>'cle' = v_cle limit 1), ''), 60)
      into v_extra, v_nom
      from mission_extra_prevu x
     where x.mission_id = m.id and x.genre = 'photos_arrivee' and x.statut in ('prevu', 'fait')
       and exists (select 1 from jsonb_array_elements(x.photos_demandees) d where d->>'cle' = v_cle)
     order by x.created_at limit 1;
    if v_extra is null then raise exception 'photo_demandee_inconnue'; end if;
    if length(v_nom) < 1 then v_nom := 'Photo guide d''arrivée'; end if;
  elsif p_piece_id is not null then
    select p.nom into v_nom from inventaire_piece p join bien_toolbox bt on bt.id = p.bien_id where p.id = p_piece_id and bt.bien_id = m.bien_id;
    if v_nom is null then raise exception 'zone_hors_bien'; end if;
  else
    v_nom := left(trim(coalesce(p_zone_nom, '')), 60);
    if length(v_nom) < 1 then raise exception 'zone_obligatoire'; end if;
  end if;
  if v_cle is null then
    if not intervention_photos_attendues(m.id, t.type_terrain) then raise exception 'pas_d_intervention_photo'; end if;
    select x.id into v_extra from mission_extra_prevu x where x.mission_id = m.id and x.genre = 'menage_pousse' and x.statut in ('prevu', 'fait') order by x.created_at limit 1;
  end if;
  begin
    insert into mission_extra_prevu_photo (extra_id, mission_id, moment, url, storage_path, commentaire, prise_le, ae_id, piece_id, zone_nom, ordre, client_id, demande_cle)
    values (v_extra, m.id, p_moment, p_url, p_storage_path, nullif(left(trim(coalesce(p_commentaire, '')), 500), ''),
            least(coalesce(p_prise_le, now()), now()), m.ae_id, p_piece_id, v_nom,
            coalesce((select max(f.ordre) from mission_extra_prevu_photo f where f.mission_id = m.id and f.moment = p_moment), 0) + 10,
            p_client_id, v_cle)
    returning id into v;
  exception when unique_violation then
    select f.id into v from mission_extra_prevu_photo f where f.client_id = p_client_id;
    if v is null then raise; end if;
  end;
  return v;
end $$;
revoke all on function public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.intervention_photo_ajouter(uuid, text, text, text, uuid, text, text, timestamptz, uuid) to authenticated;

-- Point de vérification ménage poussé / de fond : les photos de guide d'arrivée n'en font pas partie.
create or replace function public.intervention_photo_anomalie(p_mission_id uuid, p_type_terrain text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_manques text; v_nb int; v_lib text;
begin
  if not intervention_photos_attendues(p_mission_id, p_type_terrain) then return null; end if;
  if (select date_mission from mission_menage where id = p_mission_id) < date '2026-10-19' then return null; end if;
  v_lib := case when coalesce(p_type_terrain, '') = 'demande_menage' then 'ménage de fond' else 'ménage poussé' end;
  select count(*) into v_nb from mission_extra_prevu_photo where mission_id = p_mission_id and supprimee_le is null and demande_cle is null;
  if v_nb = 0 then return v_lib || ' sans photo avant / après'; end if;
  select string_agg(z.nom || ' (' || case when not z.a_avant and not z.a_apres then 'ni avant ni après' when not z.a_avant then 'pas d''avant' else 'pas d''après' end || ')', ', ' order by z.nom)
    into v_manques
    from (select coalesce(max(zone_nom), 'Zone') as nom, bool_or(moment = 'avant') a_avant, bool_or(moment = 'apres') a_apres
            from mission_extra_prevu_photo where mission_id = p_mission_id and supprimee_le is null and demande_cle is null
           group by coalesce(piece_id::text, 'libre:' || lower(trim(zone_nom)))) z
   where not (z.a_avant and z.a_apres);
  if v_manques is null then return null; end if;
  return 'photos ' || v_lib || ' incomplètes : ' || v_manques;
end $$;
revoke all on function public.intervention_photo_anomalie(uuid, text) from public, anon;
grant execute on function public.intervention_photo_anomalie(uuid, text) to authenticated;

-- ── 4. Demandes par bien ─────────────────────────────────────────────────────────────────────
create table if not exists public.arrivee_photo_demande (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,      -- bien « porteur » (missions cherchées sur bien_ids)
  bien_ids uuid[] not null,                                                -- biens dont une mission peut porter la demande
  photos jsonb not null,                                                   -- [{cle, libelle, cibles:[{bien_id, bien_code, etape_id}]}]
  statut text not null default 'a_planifier' check (statut in ('a_planifier', 'planifiee', 'faite', 'annulee')),
  extra_id uuid references public.mission_extra_prevu(id) on delete set null,
  mission_id uuid references public.mission_menage(id) on delete set null,
  planifiee_le timestamptz,
  essais integer not null default 0,                                       -- nombre de rattachements (re-planifications)
  note text,
  cree_par_nom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists arrivee_photo_demande_ouverte_uniq on public.arrivee_photo_demande (bien_id) where statut in ('a_planifier', 'planifiee');
comment on table public.arrivee_photo_demande is
  'Photos manquantes d''un guide d''arrivée demandées à l''équipe (514). Rattachée à la prochaine mission ménage par arrivee_photo_planifier() (extra prévu photos_arrivee). Service seul.';
alter table public.arrivee_photo_demande enable row level security;
revoke all on public.arrivee_photo_demande from anon, authenticated;

create or replace function public.arrivee_photo_instructions(p_photos jsonb)
returns text language sql immutable set search_path = public as $$
  select 'Pendant ce ménage, prends ces photos pour le guide d''arrivée des voyageurs :' || chr(10)
      || string_agg(n || '. ' || (d->>'libelle'), chr(10) order by n) || chr(10) || chr(10)
      || 'Cadrage : téléphone en PORTRAIT, à la lumière du jour si possible, comme le voit un voyageur qui arrive.' || chr(10)
      || 'Règle : jamais de code lisible (molettes brouillées, clavier vide, boîte fermée) et personne sur la photo.' || chr(10)
      || 'Dépose chaque photo dans « 📸 Photos pour le guide » de la mission, puis coche Fait.'
  from jsonb_array_elements(p_photos) with ordinality as e(d, n)
$$;

-- Rattachement / suivi. p_dry = true : ne fait que dire ce qui serait fait.
create or replace function public.arrivee_photo_planifier(p_dry boolean default false)
returns table (demande_id uuid, bien_code text, action text, mission_id uuid, date_mission date, ae_prenom text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  d arrivee_photo_demande; x mission_extra_prevu; m mission_menage; v_ae text; v_type uuid; v_extra uuid; v_n int;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_heure time := (now() at time zone 'Europe/Paris')::time;
  v_code text;
begin
  select id into v_type from prestation_type where lower(trim(nom)) = lower('Photos guide d''arrivée') limit 1;
  for d in select * from arrivee_photo_demande where statut in ('a_planifier', 'planifiee') order by created_at loop
    select code into v_code from bien where id = d.bien_id;
    -- Suivi d'une demande planifiée
    if d.statut = 'planifiee' then
      select * into x from mission_extra_prevu where id = d.extra_id;
      select * into m from mission_menage where id = d.mission_id;
      if x.id is not null and x.statut = 'fait' then
        if not p_dry then update arrivee_photo_demande set statut = 'faite', updated_at = now() where id = d.id; end if;
        demande_id := d.id; bien_code := v_code; action := 'faite'; mission_id := d.mission_id; date_mission := m.date_mission; ae_prenom := null; return next;
        continue;
      end if;
      if x.id is not null and x.statut = 'prevu' and m.id is not null and coalesce(m.statut, '') <> 'cancelled' then
        continue;   -- toujours prévue sur une mission valable (mission finie sans photos : le hub la signale, le bureau tranche)
      end if;
      -- extra annulé / pas fait / mission annulée ou disparue → on repart
      if not p_dry then
        if x.id is not null and x.statut = 'prevu' then
          update mission_extra_prevu set statut = 'annule', annule_le = now(), annule_par_nom = 'PowerHouse (mission annulée)', updated_at = now() where id = x.id;
        end if;
        update arrivee_photo_demande set statut = 'a_planifier', extra_id = null, mission_id = null, updated_at = now() where id = d.id;
      end if;
      demande_id := d.id; bien_code := v_code; action := 'a_replanifier'; mission_id := d.mission_id; date_mission := m.date_mission; ae_prenom := null; return next;
    end if;
    -- Prochaine mission ménage avec un intervenant, pas démarrée, dans les 30 jours
    select mm.* into m
      from mission_menage mm left join mission_terrain t on t.mission_id = mm.id
     where mm.bien_id = any(d.bien_ids) and mm.ae_id is not null and mm.statut = 'planifie' and mm.type_mission in ('checkout', 'recouche')
       and t.started_at is null
       and (mm.date_mission > v_today or (mm.date_mission = v_today and mm.heure_mission is not null and mm.heure_mission > v_heure + interval '1 hour'))
       and mm.date_mission <= v_today + 30
     order by mm.date_mission, mm.heure_mission nulls last, (mm.bien_id = d.bien_id) desc
     limit 1;
    if m.id is null then
      demande_id := d.id; bien_code := v_code; action := 'sans_mission'; mission_id := null; date_mission := null; ae_prenom := null; return next;
      continue;
    end if;
    select prenom into v_ae from auto_entrepreneur where id = m.ae_id;
    v_n := jsonb_array_length(d.photos);
    if not p_dry then
      insert into mission_extra_prevu (mission_id, genre, prestation_type_id, libelle, instructions, duree_prevue_minutes, type_imputation, photos_demandees, cree_par_nom)
      values (m.id, 'photos_arrivee', v_type, 'Photos pour le guide d''arrivée', arrivee_photo_instructions(d.photos),
              greatest(10, least(60, 5 * v_n)), 'dcb_direct', d.photos, 'PowerHouse (guides d''arrivée)')
      returning id into v_extra;
      insert into mission_journal (mission_id, bien_id, type, apres, texte, auteur_nom)
      values (m.id, m.bien_id, 'extra_prevu', jsonb_build_object('extra_id', v_extra, 'genre', 'photos_arrivee', 'demande_id', d.id, 'photos', v_n),
              'Extra prévu pour ' || coalesce(v_ae, 'l''intervenant') || ' : 📸 Photos pour le guide d''arrivée (' || v_n || ' photo' || case when v_n > 1 then 's' else '' end || ', payé par DCB)',
              'PowerHouse (guides d''arrivée)');
      update arrivee_photo_demande set statut = 'planifiee', extra_id = v_extra, mission_id = m.id, planifiee_le = now(), essais = essais + 1, updated_at = now() where id = d.id;
    end if;
    demande_id := d.id; bien_code := v_code; action := 'planifiee'; mission_id := m.id; date_mission := m.date_mission; ae_prenom := v_ae; return next;
  end loop;
end $$;
revoke all on function public.arrivee_photo_planifier(boolean) from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('arrivee-photo-planifier') where exists (select 1 from cron.job where jobname = 'arrivee-photo-planifier');
  perform cron.schedule('arrivee-photo-planifier', '20 */2 * * *', 'select count(*) from public.arrivee_photo_planifier(false)');
end $$;

commit;
