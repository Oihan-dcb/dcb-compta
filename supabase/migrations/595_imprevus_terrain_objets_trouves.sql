-- 595 — Imprévus sur le terrain + objets trouvés (portail AE « ⚠️ Un imprévu ? », 23/10/2026)
--
-- Consignes validées par Oïhan le 23/10/2026 (Powy staff) :
--   🚪 Voyageurs encore là   → alerte urgente au bureau avec l'heure ; compteur d'attente enregistré (preuve pour la
--                              pénalité de départ tardif, 470) ; le bureau décide, RIEN n'est envoyé au voyageur.
--   ⏰ Je serai en retard    → prévient le bureau ; urgent si une arrivée de voyageurs a lieu le jour même sur ce bien.
--   🔑 Problème d'accès      → ticket technique « Serrure / clés » urgent (tech_issues, circuit existant) + compteur.
--   🧳 Objet oublié          → photo obligatoire + endroit + description, rattaché à la mission / au séjour ; urgent
--                              pour papiers, bijoux, ordinateur, téléphone. Suivi bureau (statuts) ; PAS d'envoi
--                              automatique au voyageur.
-- Sécurité : aucune écriture directe par l'AE. Deux RPC SECURITY DEFINER vérifient que la mission est celle de l'AE
-- connectée (auth_user_owns_ae) et calculent elles-mêmes l'urgence et le séjour concerné. Lecture : l'AE voit les
-- siens ; le bureau / staff selon son périmètre (mêmes règles que tech_issues).

-- ── Imprévus ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.terrain_imprevu (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('voyageurs_presents', 'retard', 'acces')),
  mission_id uuid not null references public.mission_menage(id) on delete cascade,
  bien_id uuid references public.bien(id) on delete set null,
  ae_id uuid not null references public.auto_entrepreneur(id),
  reservation_id uuid references public.reservation(id) on delete set null, -- séjour qui part (voyageurs encore là)
  signale_at timestamptz not null default now(),
  retard_minutes integer check (retard_minutes is null or retard_minutes between 5 and 240),
  arrivee_estimee timestamptz,                  -- retard : heure d'arrivée annoncée (signalement + minutes)
  urgent boolean not null default false,
  urgence_motif text,
  attente_fin_at timestamptz,                   -- voyageurs partis / accès réglé (touché par l'AE)
  attente_minutes integer generated always as (
    case when attente_fin_at is null then null
         else greatest(0, floor(extract(epoch from (attente_fin_at - signale_at)) / 60))::integer end) stored,
  tech_issue_id uuid references public.tech_issues(id) on delete set null,
  note text check (note is null or length(note) <= 500),
  traite_at timestamptz,
  traite_par text,
  traite_note text,
  created_at timestamptz not null default now()
);
create index if not exists terrain_imprevu_mission_idx on public.terrain_imprevu (mission_id);
create index if not exists terrain_imprevu_ouverts_idx on public.terrain_imprevu (signale_at desc) where traite_at is null;
comment on table public.terrain_imprevu is '595 — imprévus terrain déclarés par l''AE (voyageurs encore là, retard, accès). Écriture via RPC terrain_imprevu_signaler / terrain_imprevu_fin_attente uniquement ; aucun envoi au voyageur.';

alter table public.terrain_imprevu enable row level security;
drop policy if exists terrain_imprevu_lecture on public.terrain_imprevu;
create policy terrain_imprevu_lecture on public.terrain_imprevu for select to authenticated using (
  auth_user_owns_ae(ae_id)
  or (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
);
drop policy if exists terrain_imprevu_bureau_maj on public.terrain_imprevu;
create policy terrain_imprevu_bureau_maj on public.terrain_imprevu for update to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
grant select, update on public.terrain_imprevu to authenticated;

-- ── Objets trouvés ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.objet_trouve (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references public.mission_menage(id) on delete set null,
  bien_id uuid references public.bien(id) on delete set null,
  ae_id uuid references public.auto_entrepreneur(id),
  reservation_id uuid references public.reservation(id) on delete set null, -- séjour probable du propriétaire de l'objet
  categorie text not null default 'autre' check (categorie in ('papiers', 'bijoux', 'ordinateur', 'telephone', 'argent_carte', 'vetement', 'jouet', 'chargeur', 'autre')),
  precieux boolean not null default false,       -- papiers / bijoux / ordinateur / téléphone / argent → alerte urgente
  description text not null check (length(btrim(description)) between 2 and 500),
  endroit text not null check (length(btrim(endroit)) between 2 and 200),
  photos text[] not null check (cardinality(photos) between 1 and 6),
  statut text not null default 'trouve' check (statut in ('trouve', 'au_bureau', 'voyageur_prevenu', 'envoye', 'recupere', 'donne_jete')),
  statut_maj_at timestamptz,
  statut_par text,
  note_bureau text,
  created_at timestamptz not null default now()
);
create index if not exists objet_trouve_statut_idx on public.objet_trouve (statut, created_at desc);
comment on table public.objet_trouve is '595 — objets oubliés déclarés par l''AE (photo obligatoire). Statuts : trouve (à rapporter) → au_bureau → voyageur_prevenu → envoye | recupere | donne_jete (sans nouvelle à J+30). Aucun envoi automatique au voyageur.';

alter table public.objet_trouve enable row level security;
drop policy if exists objet_trouve_lecture on public.objet_trouve;
create policy objet_trouve_lecture on public.objet_trouve for select to authenticated using (
  auth_user_owns_ae(ae_id)
  or (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
);
drop policy if exists objet_trouve_bureau_maj on public.objet_trouve;
create policy objet_trouve_bureau_maj on public.objet_trouve for update to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
grant select, update on public.objet_trouve to authenticated;

-- ── RPC : déclarer un imprévu ──────────────────────────────────────────────────────────────────────
-- Idempotent : un imprévu « voyageurs_presents » / « acces » encore en attente sur la même mission est renvoyé tel quel
-- (double toucher, réseau qui reprend). Un retard se met à jour (nouvelles minutes) tant que la mission n'est pas démarrée.
create or replace function public.terrain_imprevu_signaler(
  p_mission_id uuid, p_type text, p_retard_minutes integer default null, p_note text default null, p_tech_issue_id uuid default null)
returns public.terrain_imprevu
language plpgsql security definer set search_path to 'public' as $$
declare
  m record; r public.terrain_imprevu; v_auj date := (now() at time zone 'Europe/Paris')::date;
  v_arrivee boolean; v_resa uuid;
begin
  if p_type not in ('voyageurs_presents', 'retard', 'acces') then raise exception 'type_invalide'; end if;
  select mm.id, mm.bien_id, mm.ae_id, mm.date_mission, mm.reservation_id into m from mission_menage mm where mm.id = p_mission_id;
  if m.id is null then raise exception 'mission_introuvable'; end if;
  if not auth_user_owns_ae(m.ae_id) then raise exception 'pas_ta_mission'; end if;
  if m.date_mission < v_auj - 1 or m.date_mission > v_auj + 1 then raise exception 'mission_pas_du_jour'; end if;
  if p_type = 'retard' and (p_retard_minutes is null or p_retard_minutes < 5 or p_retard_minutes > 240) then raise exception 'minutes_invalides'; end if;
  if p_tech_issue_id is not null and not exists (select 1 from tech_issues ti where ti.id = p_tech_issue_id and ti.bien_id = m.bien_id and ti.reporter_ae_id = m.ae_id) then
    raise exception 'ticket_invalide';
  end if;

  -- Arrivée de voyageurs le jour de la mission sur ce bien (séjour confirmé, hors séjour du propriétaire compris)
  select exists (select 1 from reservation x where x.bien_id = m.bien_id and x.final_status = 'accepted' and x.arrival_date = m.date_mission) into v_arrivee;
  -- Séjour qui part : celui de la mission, sinon le dernier départ ce jour-là sur ce bien
  v_resa := coalesce(m.reservation_id, (select x.id from reservation x where x.bien_id = m.bien_id and x.final_status = 'accepted' and x.departure_date = m.date_mission order by x.arrival_date desc limit 1));

  if p_type in ('voyageurs_presents', 'acces') then
    select * into r from terrain_imprevu t where t.mission_id = m.id and t.type = p_type and t.attente_fin_at is null order by t.signale_at desc limit 1;
    if r.id is not null then
      if p_tech_issue_id is not null and r.tech_issue_id is null then
        update terrain_imprevu set tech_issue_id = p_tech_issue_id where id = r.id returning * into r;
      end if;
      return r;
    end if;
    insert into terrain_imprevu (type, mission_id, bien_id, ae_id, reservation_id, urgent, urgence_motif, note, tech_issue_id)
    values (p_type, m.id, m.bien_id, m.ae_id, case when p_type = 'voyageurs_presents' then v_resa end, true,
            case when p_type = 'voyageurs_presents' then 'Voyageurs encore dans le logement' else 'AE bloquée à l''entrée' end
              || case when v_arrivee then ' · arrivée de voyageurs aujourd''hui' else '' end,
            nullif(btrim(coalesce(p_note, '')), ''), p_tech_issue_id)
    returning * into r;
    return r;
  end if;

  -- Retard
  select * into r from terrain_imprevu t where t.mission_id = m.id and t.type = 'retard' and t.traite_at is null
    and not exists (select 1 from mission_terrain mt where mt.mission_id = m.id and mt.started_at is not null)
    order by t.signale_at desc limit 1;
  if r.id is not null then
    update terrain_imprevu set retard_minutes = p_retard_minutes, signale_at = now(), arrivee_estimee = now() + make_interval(mins => p_retard_minutes),
      urgent = v_arrivee, urgence_motif = case when v_arrivee then 'Arrivée de voyageurs aujourd''hui sur ce logement' end,
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
    where id = r.id returning * into r;
    return r;
  end if;
  insert into terrain_imprevu (type, mission_id, bien_id, ae_id, retard_minutes, arrivee_estimee, urgent, urgence_motif, note)
  values ('retard', m.id, m.bien_id, m.ae_id, p_retard_minutes, now() + make_interval(mins => p_retard_minutes), v_arrivee,
          case when v_arrivee then 'Arrivée de voyageurs aujourd''hui sur ce logement' end, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into r;
  return r;
end $$;

-- Fin d'attente (voyageurs partis / accès réglé) : arrête le compteur, une seule fois.
create or replace function public.terrain_imprevu_fin_attente(p_imprevu_id uuid, p_note text default null)
returns public.terrain_imprevu
language plpgsql security definer set search_path to 'public' as $$
declare r public.terrain_imprevu;
begin
  select * into r from terrain_imprevu where id = p_imprevu_id;
  if r.id is null then raise exception 'imprevu_introuvable'; end if;
  if not auth_user_owns_ae(r.ae_id) then raise exception 'pas_ta_mission'; end if;
  if r.type = 'retard' then raise exception 'type_invalide'; end if;
  if r.attente_fin_at is not null then return r; end if;
  update terrain_imprevu set attente_fin_at = greatest(now(), signale_at),
    note = case when nullif(btrim(coalesce(p_note, '')), '') is null then note else concat_ws(' · ', note, btrim(p_note)) end
  where id = r.id returning * into r;
  return r;
end $$;

-- ── RPC : déclarer un objet oublié ─────────────────────────────────────────────────────────────────
create or replace function public.objet_trouve_declarer(
  p_mission_id uuid, p_categorie text, p_description text, p_endroit text, p_photos text[])
returns public.objet_trouve
language plpgsql security definer set search_path to 'public' as $$
declare m record; o public.objet_trouve; v_auj date := (now() at time zone 'Europe/Paris')::date; v_resa uuid; v_cat text;
begin
  select mm.id, mm.bien_id, mm.ae_id, mm.date_mission, mm.reservation_id into m from mission_menage mm where mm.id = p_mission_id;
  if m.id is null then raise exception 'mission_introuvable'; end if;
  if not auth_user_owns_ae(m.ae_id) then raise exception 'pas_ta_mission'; end if;
  if m.date_mission < v_auj - 2 or m.date_mission > v_auj + 1 then raise exception 'mission_pas_du_jour'; end if;
  if p_photos is null or cardinality(p_photos) < 1 then raise exception 'photo_obligatoire'; end if;
  if exists (select 1 from unnest(p_photos) u where u !~ '^https://omuncchvypbtxkpalwcr\.supabase\.co/storage/v1/object/public/tech-photos/') then raise exception 'photo_invalide'; end if;
  if length(btrim(coalesce(p_endroit, ''))) < 2 then raise exception 'endroit_obligatoire'; end if;
  if length(btrim(coalesce(p_description, ''))) < 2 then raise exception 'description_obligatoire'; end if;
  v_cat := case when p_categorie in ('papiers', 'bijoux', 'ordinateur', 'telephone', 'argent_carte', 'vetement', 'jouet', 'chargeur', 'autre') then p_categorie else 'autre' end;
  -- Séjour probable : celui de la mission, sinon le dernier séjour parti au plus tard le jour de la mission
  v_resa := coalesce(m.reservation_id, (select x.id from reservation x where x.bien_id = m.bien_id and x.final_status = 'accepted'
                                         and x.departure_date <= m.date_mission order by x.departure_date desc, x.arrival_date desc limit 1));
  insert into objet_trouve (mission_id, bien_id, ae_id, reservation_id, categorie, precieux, description, endroit, photos)
  values (m.id, m.bien_id, m.ae_id, v_resa, v_cat, v_cat in ('papiers', 'bijoux', 'ordinateur', 'telephone', 'argent_carte'),
          left(btrim(p_description), 500), left(btrim(p_endroit), 200), p_photos[1:6])
  returning * into o;
  return o;
end $$;

revoke all on function public.terrain_imprevu_signaler(uuid, text, integer, text, uuid) from public, anon;
revoke all on function public.terrain_imprevu_fin_attente(uuid, text) from public, anon;
revoke all on function public.objet_trouve_declarer(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.terrain_imprevu_signaler(uuid, text, integer, text, uuid) to authenticated;
grant execute on function public.terrain_imprevu_fin_attente(uuid, text) to authenticated;
grant execute on function public.objet_trouve_declarer(uuid, text, text, text, text[]) to authenticated;
