-- NB : numérotée 430 dans le dépôt (le 429 a été pris en parallèle par 429_site_pages_contenu_canaux) ; appliquée en base sous les noms
-- « 429_couchages_configurations_recouche_minimum » et « 429b_couchages_linge_equipe_sacs » (429c et données : API SQL). Les commentaires SQL disent « 429 ».
-- 429 — Couchages du bien (SOURCE UNIQUE) + configurations au choix + prix minimum des recouches (15/10/2026, Oïhan).
--
--  1. RECOUCHE SANS CHANGEMENT : ménage × 1,30 − 45 € par lit utilisé, avec un MINIMUM EN EUROS (50 €), modifiable dans
--     🌐 › 🧺 Services (direct_service.prix_minimum_centimes). Remplace le plancher « 0,5 × ménage » (prix_plancher_coef,
--     colonne gardée, n'est plus lue). Calcul : dcb-planning api/_services.js prixService.
--  2. COUCHAGES (bien_lit) : chaque lit / canapé-lit du bien, par pièce, avec sa taille ; un lit peut se transformer
--     (ex. BGH : king 180 → 2 lits 90). Saisis dans la fiche bien (onglet 📸 Annonce, bloc 🛏 Couchages). Préremplis
--     depuis Hospitable (room_details, gardés par la synchro des biens) quand le bien n'a encore rien.
--  3. CONFIGURATIONS (bien_couchage) : construites à partir de ces lits (quels lits sont faits, transformés ou non).
--     Un canapé-lit ne compte que s'il fait partie de la configuration. Sans configuration : configuration implicite
--     « Standard » = tous les lits hors canapé-lit, tels quels. Dérivés (fonction couchage_detail) : couchages,
--     lits faits (= jeux de draps), draps par taille, texte FR/EN/ES, consigne de mise en place.
--  4. bien_lits_v lit d'abord les couchages (source 'couchages'), puis bien.nb_lits, fiche linge, capacité / 2.
--  5. Choix par séjour (reservation_couchage, clé = id Hospitable de la résa) : voyageur (site) ou bureau ; sinon
--     configuration par défaut selon les voyageurs. Transmis à l'AE (terrain_contexte_sejours), au hub, aux sacs.

-- ─── 1. Prix minimum en euros ────────────────────────────────────────────────────────────────────────
alter table public.direct_service add column if not exists prix_minimum_centimes integer
  check (prix_minimum_centimes is null or prix_minimum_centimes between 0 and 50000);
comment on column public.direct_service.prix_minimum_centimes is 'Règle menage_coef : prix jamais sous ce montant (centimes ; recouche sans changement : 5000 = 50 €). Remplace prix_plancher_coef (429).';
comment on column public.direct_service.prix_plancher_coef is 'OBSOLÈTE depuis 429 (remplacé par prix_minimum_centimes), plus lu.';
update public.direct_service set prix_minimum_centimes = 5000, prix_plancher_coef = null, maj_par = 'migration 429', maj_le = now()
where mission_type = 'recouche' and recouche_linge = false and prix_regle = 'menage_coef';
update public.direct_service set prix_plancher_coef = null, maj_le = now() where mission_type = 'recouche' and recouche_linge = true;

-- ─── 2. Couchages du bien ────────────────────────────────────────────────────────────────────────────
create table if not exists public.bien_lit (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,
  piece text not null default 'Chambre' check (char_length(piece) between 1 and 60),
  type text not null check (type in ('simple', 'double', 'queen', 'king', 'canape_lit', 'superpose', 'appoint')),
  largeur_cm smallint check (largeur_cm is null or largeur_cm between 60 and 220),
  longueur_cm smallint not null default 200 check (longueur_cm between 150 and 220),
  places smallint check (places is null or places between 1 and 4),
  -- Lit transformable (ex. king 180 → 2 lits simples 90) : utilisé « transformé » dans une configuration.
  transforme_type text check (transforme_type is null or transforme_type in ('simple', 'double', 'queen', 'king')),
  transforme_nombre smallint check (transforme_nombre is null or transforme_nombre between 1 and 4),
  transforme_largeur_cm smallint check (transforme_largeur_cm is null or transforme_largeur_cm between 60 and 220),
  ordre smallint not null default 100,
  actif boolean not null default true,
  note text check (note is null or char_length(note) <= 200),
  source text not null default 'saisi' check (source in ('saisi', 'hospitable', 'migration')),
  maj_le timestamptz not null default now(),
  maj_par text,
  constraint bien_lit_transforme check ((transforme_type is null) = (transforme_nombre is null))
);
create index if not exists bien_lit_bien on public.bien_lit (bien_id) where actif;
comment on table public.bien_lit is 'Couchages du bien (chaque lit / canapé-lit, par pièce, taille) — SOURCE UNIQUE : configurations, lits / jeux de linge (bien_lits_v), draps par taille, mise en place AE, recouche, page Réserver. 429.';

create table if not exists public.bien_couchage (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,
  nom text not null check (char_length(nom) between 2 and 60),
  -- Lits faits dans cette configuration : [{ "lit_id": uuid, "mode": "normal" | "transforme" }] ; lit absent = non fait.
  lits jsonb not null default '[]'::jsonb check (jsonb_typeof(lits) = 'array'),
  supplement_centimes integer not null default 0 check (supplement_centimes between 0 and 100000),
  consigne text check (consigne is null or char_length(consigne) <= 300),
  serviettes_par_personne smallint not null default 1 check (serviettes_par_personne between 0 and 5),
  ordre smallint not null default 100,
  actif boolean not null default true,
  maj_le timestamptz not null default now(),
  maj_par text
);
create index if not exists bien_couchage_bien on public.bien_couchage (bien_id) where actif;
comment on table public.bien_couchage is 'Configurations de couchage proposées au voyageur, construites à partir de bien_lit (lits faits / transformés). Supplément optionnel (0 par défaut → ligne « Option voyageur » si > 0). 429.';

create table if not exists public.reservation_couchage (
  resa_hospitable_id text primary key,
  bien_id uuid not null references public.bien(id) on delete cascade,
  couchage_id uuid not null references public.bien_couchage(id),
  source text not null check (source in ('voyageur', 'bureau')),
  devis_id uuid,
  maj_le timestamptz not null default now(),
  maj_par text
);
comment on table public.reservation_couchage is 'Configuration de couchage d''un séjour : choisie par le voyageur (site) ou corrigée par le bureau. Absente = défaut selon les voyageurs (couchage_pour). 429.';

alter table public.bien_lit enable row level security;
alter table public.bien_couchage enable row level security;
alter table public.reservation_couchage enable row level security;
drop policy if exists bien_lit_staff on public.bien_lit;
create policy bien_lit_staff on public.bien_lit for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
drop policy if exists bien_couchage_staff on public.bien_couchage;
create policy bien_couchage_staff on public.bien_couchage for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
drop policy if exists reservation_couchage_staff on public.reservation_couchage;
create policy reservation_couchage_staff on public.reservation_couchage for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.bien_lit, public.bien_couchage, public.reservation_couchage from anon;
grant select, insert, update on public.bien_lit, public.bien_couchage to authenticated;
grant select on public.reservation_couchage to authenticated;
grant all on public.bien_lit, public.bien_couchage, public.reservation_couchage to service_role;

-- Données Hospitable gardées par la synchro des biens (dcb-compta api/sync-biens.js) : pièces + lits, capacité.
alter table public.bien add column if not exists hospitable_room_details jsonb;
alter table public.bien add column if not exists hospitable_capacite smallint;
comment on column public.bien.hospitable_room_details is 'room_details Hospitable (pièces et lits) — préremplit bien_lit si vide. 429.';

-- ─── Détail calculé d'une liste de lits faits ────────────────────────────────────────────────────────
create or replace function public.lit_largeur_defaut(p_type text) returns smallint language sql immutable as $$
  select (case p_type when 'simple' then 90 when 'double' then 140 when 'queen' then 160 when 'king' then 180
    when 'canape_lit' then 140 when 'superpose' then 90 else 90 end)::smallint $$;
create or replace function public.lit_places_defaut(p_type text) returns smallint language sql immutable as $$
  select (case p_type when 'simple' then 1 when 'appoint' then 1 else 2 end)::smallint $$;

-- p_lits = [{lit_id, mode}] → { places, lits (jeux de draps), draps:[{taille,qte}], grands, petits, canapes, superposes,
--   texte:{fr,en,es}, pieces:[{piece, fr}], consigne_auto }
create or replace function public.couchage_detail(p_bien uuid, p_lits jsonb) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  r record; v_mode text; v_type text; v_n int; v_larg int; v_places int := 0; v_jeux int := 0;
  v_grands int := 0; v_petits int := 0; v_canapes int := 0; v_sup int := 0; v_app int := 0;
  v_draps jsonb := '{}'::jsonb; v_taille text; v_pieces jsonb := '[]'::jsonb; v_cons text[] := '{}'; v_el text; k int;
  pl text;
  fr text; en text; es text;
begin
  for r in select l.* from bien_lit l where l.bien_id = p_bien and l.actif
             and l.id in (select (e->>'lit_id')::uuid from jsonb_array_elements(coalesce(p_lits, '[]'::jsonb)) e where (e->>'lit_id') ~ '^[0-9a-f-]{36}$')
           order by l.ordre, l.piece, l.id loop
    select coalesce(e->>'mode', 'normal') into v_mode from jsonb_array_elements(p_lits) e where e->>'lit_id' = r.id::text limit 1;
    if v_mode = 'transforme' and r.transforme_type is not null then
      v_type := r.transforme_type; v_n := r.transforme_nombre; v_larg := coalesce(r.transforme_largeur_cm, lit_largeur_defaut(r.transforme_type));
      v_cons := v_cons || format('%s : %s à installer en %s lit%s %s×%s', r.piece,
        case r.type when 'king' then 'le grand lit' when 'queen' then 'le grand lit' when 'double' then 'le lit double' else 'le lit' end,
        v_n, case when v_n > 1 then 's' else '' end, v_larg, r.longueur_cm);
    else
      v_type := r.type; v_n := 1; v_larg := coalesce(r.largeur_cm, lit_largeur_defaut(r.type));
    end if;
    -- superposé : 2 couchettes = 2 jeux de draps de la largeur indiquée
    for k in 1..v_n loop
      if v_type = 'superpose' then
        v_places := v_places + coalesce(r.places, 2); v_jeux := v_jeux + 2; v_sup := v_sup + 1;
        v_taille := v_larg || '×' || r.longueur_cm; v_draps := jsonb_set(v_draps, array[v_taille], to_jsonb(coalesce((v_draps->>v_taille)::int, 0) + 2));
      else
        v_places := v_places + case when v_mode = 'transforme' and r.transforme_type is not null then lit_places_defaut(v_type) else coalesce(r.places, lit_places_defaut(v_type)) end;
        v_jeux := v_jeux + 1;
        v_taille := v_larg || '×' || r.longueur_cm; v_draps := jsonb_set(v_draps, array[v_taille], to_jsonb(coalesce((v_draps->>v_taille)::int, 0) + 1));
        if v_type = 'canape_lit' then v_canapes := v_canapes + 1;
        elsif v_type = 'appoint' then v_app := v_app + 1;
        elsif v_type = 'simple' then v_petits := v_petits + 1;
        else v_grands := v_grands + 1; end if;
      end if;
    end loop;
    v_el := case when v_n > 1 then v_n || ' ' else '1 ' end ||
      case v_type when 'simple' then 'petit' || case when v_n > 1 then 's lits' else ' lit' end
                  when 'canape_lit' then 'canapé' || case when v_n > 1 then 's-lits' else '-lit' end
                  when 'superpose' then 'lits superposés' when 'appoint' then 'couchage' || case when v_n > 1 then 's' else '' end || ' d''appoint'
                  else 'grand' || case when v_n > 1 then 's lits' else ' lit' end end || ' ' || v_larg || '×' || r.longueur_cm;
    v_pieces := v_pieces || jsonb_build_object('piece', r.piece, 'fr', v_el);
  end loop;
  -- Texte court, sans tailles : « 2 grands lits », « 1 grand lit + 2 petits lits + 1 canapé-lit »
  fr := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || ' grand' || case when v_grands > 1 then 's lits' else ' lit' end end,
    case when v_petits > 0 then v_petits || ' petit' || case when v_petits > 1 then 's lits' else ' lit' end end,
    case when v_sup > 0 then v_sup || ' lits superposés' end,
    case when v_canapes > 0 then v_canapes || ' canapé' || case when v_canapes > 1 then 's-lits' else '-lit' end end,
    case when v_app > 0 then v_app || ' couchage' || case when v_app > 1 then 's' else '' end || ' d''appoint' end], null), ' + ');
  en := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || ' large bed' || case when v_grands > 1 then 's' else '' end end,
    case when v_petits > 0 then v_petits || ' single bed' || case when v_petits > 1 then 's' else '' end end,
    case when v_sup > 0 then v_sup || ' bunk bed' || case when v_sup > 1 then 's' else '' end end,
    case when v_canapes > 0 then v_canapes || ' sofa bed' || case when v_canapes > 1 then 's' else '' end end,
    case when v_app > 0 then v_app || ' extra bed' || case when v_app > 1 then 's' else '' end end], null), ' + ');
  es := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || case when v_grands > 1 then ' camas grandes' else ' cama grande' end end,
    case when v_petits > 0 then v_petits || case when v_petits > 1 then ' camas individuales' else ' cama individual' end end,
    case when v_sup > 0 then v_sup || ' litera' || case when v_sup > 1 then 's' else '' end end,
    case when v_canapes > 0 then v_canapes || case when v_canapes > 1 then ' sofás cama' else ' sofá cama' end end,
    case when v_app > 0 then v_app || case when v_app > 1 then ' camas supletorias' else ' cama supletoria' end end], null), ' + ');
  select coalesce(jsonb_agg(jsonb_build_object('taille', key, 'qte', value::int) order by key desc), '[]'::jsonb) into pl from jsonb_each_text(v_draps);
  return jsonb_build_object('places', v_places, 'lits', v_jeux, 'draps', pl::jsonb, 'grands', v_grands, 'petits', v_petits, 'canapes', v_canapes, 'superposes', v_sup,
    'texte', jsonb_build_object('fr', fr, 'en', en, 'es', es), 'pieces', v_pieces,
    'consigne_auto', nullif(array_to_string(v_cons, ' ; '), ''));
end $$;

-- Configurations d'un bien (explicites actives, sinon implicite « Standard » = lits hors canapé-lit, tels quels).
create or replace function public.bien_couchages(p_bien uuid)
returns table (id uuid, nom text, ordre smallint, supplement_centimes integer, consigne text, serviettes_par_personne smallint, implicite boolean, detail jsonb)
language sql stable set search_path to 'public' as $$
  select c.id, c.nom, c.ordre, c.supplement_centimes, c.consigne, c.serviettes_par_personne, false, couchage_detail(p_bien, c.lits)
  from bien_couchage c where c.bien_id = p_bien and c.actif
  union all
  select null::uuid, 'Standard', 0::smallint, 0, null::text, 1::smallint, true,
    couchage_detail(p_bien, (select coalesce(jsonb_agg(jsonb_build_object('lit_id', l.id, 'mode', 'normal')), '[]'::jsonb) from bien_lit l where l.bien_id = p_bien and l.actif and l.type <> 'canape_lit'))
  where not exists (select 1 from bien_couchage c where c.bien_id = p_bien and c.actif)
    and exists (select 1 from bien_lit l where l.bien_id = p_bien and l.actif)
  order by 3, 2 $$;

-- Configuration d'un séjour : choisie (voyageur / bureau) > défaut = la plus petite qui couche tout le monde (puis ordre),
-- sinon la plus grande. null si le bien n'a aucun couchage saisi.
create or replace function public.couchage_pour(p_bien uuid, p_resa_hospitable_id text, p_voyageurs integer)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare v jsonb; n int; v_src text;
begin
  select count(*) into n from bien_couchages(p_bien);
  if n = 0 then return null; end if;
  if p_resa_hospitable_id is not null then
    select jsonb_build_object('id', c.id, 'nom', c.nom, 'supplement_centimes', c.supplement_centimes, 'consigne', c.consigne,
             'serviettes_par_personne', c.serviettes_par_personne, 'detail', couchage_detail(c.bien_id, c.lits), 'source', rc.source, 'actif', c.actif), rc.source
      into v, v_src
      from reservation_couchage rc join bien_couchage c on c.id = rc.couchage_id
     where rc.resa_hospitable_id = p_resa_hospitable_id and c.bien_id = p_bien;
  end if;
  if v is null then
    select jsonb_build_object('id', b.id, 'nom', b.nom, 'supplement_centimes', b.supplement_centimes, 'consigne', b.consigne,
             'serviettes_par_personne', b.serviettes_par_personne, 'detail', b.detail, 'source', case when n = 1 then 'unique' else 'defaut' end, 'actif', true)
      into v
      from bien_couchages(p_bien) b
     order by case when (b.detail->>'places')::int >= coalesce(nullif(p_voyageurs, 0), 1) then 0 else 1 end,
              case when (b.detail->>'places')::int >= coalesce(nullif(p_voyageurs, 0), 1) then (b.detail->>'places')::int else -(b.detail->>'places')::int end,
              b.ordre, b.nom
     limit 1;
  end if;
  return v || jsonb_build_object('choix_possible', n > 1, 'voyageurs', p_voyageurs,
    'serviettes', coalesce((v->>'serviettes_par_personne')::int, 1) * greatest(coalesce(p_voyageurs, 0), 0));
end $$;

revoke all on function public.couchage_detail(uuid, jsonb), public.bien_couchages(uuid), public.couchage_pour(uuid, text, integer) from public, anon;
grant execute on function public.couchage_detail(uuid, jsonb), public.bien_couchages(uuid), public.couchage_pour(uuid, text, integer) to authenticated, service_role;

-- ─── 4. Lits du bien : couchages d'abord ─────────────────────────────────────────────────────────────
create or replace view public.bien_lits_v with (security_invoker = true) as
select b.id as bien_id, b.code, b.agence, b.capacite,
  coalesce(nullif(c.lits_max, 0), b.nb_lits, nullif(l.housses, 0), case when b.capacite > 0 then ceil(b.capacite / 2.0)::int end) as nb_lits,
  case when coalesce(c.lits_max, 0) > 0 then 'couchages' when b.nb_lits is not null then 'saisi' when coalesce(l.housses, 0) > 0 then 'fiche_linge' when b.capacite > 0 then 'capacite' end as source,
  nullif(l.housses, 0) as housses_fiche_linge,
  coalesce(l.canape, false) as canape_dans_linge,
  c.places_max as places_couchages,
  c.nb_configs as configurations
from public.bien b
left join lateral (
  select sum((m[1])::int) as housses, bool_or(t.linge_plat ~* 'canap') as canape
  from public.bien_toolbox t
  left join lateral regexp_matches(coalesce(t.linge_plat, ''), '(\d+)\s*housses?\s+de\s+couette', 'gi') m on true
  where t.bien_id = b.id and t.archived_at is null
) l on true
left join lateral (
  select max((x.detail->>'lits')::int) as lits_max, max((x.detail->>'places')::int) as places_max, count(*) filter (where not x.implicite) as nb_configs
  from public.bien_couchages(b.id) x
) c on true;
comment on view public.bien_lits_v is 'Nombre de lits (= jeux de draps + serviettes) : couchages (bien_lit / bien_couchage, max des configurations) > saisi > fiche linge (housses de couette) > capacité / 2. 429.';
revoke all on public.bien_lits_v from anon;
grant select on public.bien_lits_v to authenticated, service_role;

-- ─── 5. Choix d'un séjour par le bureau (et recouches vendues de ce séjour mises à jour) ────────────
create or replace function public.reservation_couchage_choisir(p_resa_hospitable_id text, p_couchage uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_bien uuid; v_c bien_couchage; v_det jsonb; v_qui text := coalesce(auth.jwt()->>'email', 'service');
begin
  if not (auth.role() = 'service_role' or auth_user_is_staff()) then raise exception 'interdit'; end if;
  select r.bien_id into v_bien from reservation r where r.hospitable_id = p_resa_hospitable_id limit 1;
  if v_bien is null then raise exception 'reservation_introuvable'; end if;
  if auth.role() <> 'service_role' and my_secteurs() is not null and v_bien not in (select my_scoped_bien_ids()) then raise exception 'interdit'; end if;
  select * into v_c from bien_couchage c where c.id = p_couchage and c.bien_id = v_bien and c.actif;
  if v_c.id is null then raise exception 'configuration_inconnue'; end if;
  v_det := couchage_detail(v_bien, v_c.lits);
  insert into reservation_couchage (resa_hospitable_id, bien_id, couchage_id, source, maj_le, maj_par)
  values (p_resa_hospitable_id, v_bien, v_c.id, 'bureau', now(), v_qui)
  on conflict (resa_hospitable_id) do update set couchage_id = excluded.couchage_id, source = 'bureau', maj_le = now(), maj_par = v_qui;
  -- Recouches vendues de ce séjour pas encore faites : lits utilisés = lits faits de la configuration.
  update mission_menage m set recouche_jeux = (v_det->>'lits')::int, updated_at = now()
   where m.vente_resa_hospitable_id = p_resa_hospitable_id and m.type_mission = 'recouche' and m.statut = 'planifie'
     and m.date_mission >= current_date and (v_det->>'lits')::int between 1 and 30;
  return couchage_pour(v_bien, p_resa_hospitable_id, null);
end $$;
revoke all on function public.reservation_couchage_choisir(text, uuid) from public, anon;
grant execute on function public.reservation_couchage_choisir(text, uuid) to authenticated, service_role;

-- ─── Contexte AE : configuration du séjour qui arrive (ménage d'arrivée) et du séjour en cours (recouche) ──
drop function if exists public.terrain_contexte_sejours(uuid[]);
create or replace function public.terrain_contexte_sejours(p_mission_ids uuid[])
returns table (mission_id uuid, depart_guest text, depart_code text, depart_date date, encours_guest text, encours_code text, encours_depart date,
  arrivee_date date, arrivee_checkin text, arrivee_guests integer, arrivee_proprio boolean, arrivee_couchage jsonb, encours_couchage jsonb)
language sql stable security definer set search_path to 'public' as $function$
  select m.id,
    rd.guest_name, rd.code, rd.departure_date,
    rc.guest_name, rc.code, rc.departure_date,
    ra.arrival_date, ra.checkin_time, ra.guest_count, ra.owner_stay,
    case when ra.hospitable_id is not null then couchage_pour(m.bien_id, ra.hospitable_id, ra.guest_count) end,
    case when rc.hospitable_id is not null then couchage_pour(m.bien_id, rc.hospitable_id, rc.guest_count) end
  from mission_menage m
  left join reservation rd on rd.id = m.reservation_id
  left join lateral (select r.guest_name, r.code, r.departure_date, r.hospitable_id, r.guest_count from reservation r
                      where r.bien_id = m.bien_id and r.final_status = 'accepted'
                        and r.arrival_date <= m.date_mission and r.departure_date > m.date_mission
                      order by r.arrival_date desc limit 1) rc on true
  left join lateral (select r.arrival_date, r.checkin_time, r.guest_count, r.owner_stay, r.hospitable_id from reservation r
                      where r.bien_id = m.bien_id and r.final_status = 'accepted'
                        and r.arrival_date >= m.date_mission and r.arrival_date <= m.date_mission + 21
                      order by r.arrival_date limit 1) ra on true
  where m.id = any(p_mission_ids)
    and (auth_user_owns_ae(m.ae_id) or auth_user_is_bureau()
         or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))));
$function$;
revoke all on function public.terrain_contexte_sejours(uuid[]) from public, anon;
grant execute on function public.terrain_contexte_sejours(uuid[]) to authenticated, service_role;

-- Sacs et tâches : arrivées des prochains jours dans les biens à plusieurs configurations (draps par taille, mise en place).
create or replace function public.couchages_a_preparer(p_du date, p_au date)
returns table (bien_id uuid, code text, arrivee date, resa_code text, voyageurs integer, couchage jsonb)
language sql stable security definer set search_path to 'public' as $$
  select r.bien_id, b.code, r.arrival_date, r.code, r.guest_count, couchage_pour(r.bien_id, r.hospitable_id, r.guest_count)
  from reservation r join bien b on b.id = r.bien_id
  where r.final_status = 'accepted' and r.arrival_date between p_du and least(p_au, p_du + 31)
    and exists (select 1 from bien_couchage c where c.bien_id = r.bien_id and c.actif)
    and (auth.role() = 'service_role' or (auth_user_is_staff() and (my_secteurs() is null or r.bien_id in (select my_scoped_bien_ids()))))
  order by r.arrival_date, b.code $$;
revoke all on function public.couchages_a_preparer(date, date) from public, anon;
grant execute on function public.couchages_a_preparer(date, date) to authenticated, service_role;

-- ─── Préremplissage depuis Hospitable (room_details) quand le bien n'a encore aucun couchage ────────────
create or replace function public.bien_lits_depuis_hospitable(p_bien uuid) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare rd jsonb; room jsonb; bed jsonb; k int; n int := 0; v_ch int := 0; v_piece text; v_type text; q int; o int := 0;
begin
  if exists (select 1 from bien_lit where bien_id = p_bien) then return 0; end if;
  select hospitable_room_details into rd from bien where id = p_bien;
  if rd is null or jsonb_typeof(rd) <> 'array' then return 0; end if;
  for room in select * from jsonb_array_elements(rd) loop
    if jsonb_array_length(coalesce(room->'beds', '[]'::jsonb)) = 0 then continue; end if;
    if room->>'type' = 'bedroom' then v_ch := v_ch + 1; end if;
    v_piece := case room->>'type' when 'bedroom' then 'Chambre ' || v_ch when 'living_room' then 'Séjour' when 'studio' then 'Pièce principale'
      when 'common_space' then 'Espace commun' when 'office' then 'Bureau' when 'loft' then 'Mezzanine' else initcap(replace(room->>'type', '_', ' ')) end;
    for bed in select * from jsonb_array_elements(room->'beds') loop
      v_type := case bed->>'type' when 'single_bed' then 'simple' when 'double_bed' then 'double' when 'queen_bed' then 'queen' when 'king_bed' then 'king'
        when 'sofa_bed' then 'canape_lit' when 'bunk_bed' then 'superpose' when 'floor_mattress' then 'appoint' when 'air_mattress' then 'appoint'
        when 'water_bed' then 'double' when 'futon' then 'appoint' else null end; -- couch, crib, toddler_bed, hammock : pas un couchage adulte
      if v_type is null then continue; end if;
      q := greatest(1, least(coalesce((bed->>'quantity')::int, 1), 10));
      for k in 1..q loop
        o := o + 1;
        insert into bien_lit (bien_id, piece, type, largeur_cm, ordre, source, maj_par, note)
        values (p_bien, v_piece, v_type, lit_largeur_defaut(v_type), o, 'hospitable', 'préremplissage Hospitable',
                'Taille par défaut (annonce Hospitable : ' || (bed->>'type') || ') — à vérifier');
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.bien_lits_depuis_hospitable(uuid) from public, anon, authenticated;
grant execute on function public.bien_lits_depuis_hospitable(uuid) to service_role;

create or replace function public.trg_bien_room_details_prefill() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.hospitable_room_details is not null and new.hospitable_room_details is distinct from old.hospitable_room_details then
    perform bien_lits_depuis_hospitable(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_bien_room_details_prefill on public.bien;
create trigger trg_bien_room_details_prefill after update of hospitable_room_details on public.bien
  for each row execute function public.trg_bien_room_details_prefill();

-- ═══ 429b (appliquée) ═══
-- 429b — Vocabulaire linge de l'équipe (feuilles de préparation des sacs : « Drap King / Queen / Twin ») + référence des sacs.
-- La taille des DRAPS (King, Queen, Twin) n'est pas la largeur du lit (ex. 416 : lit 160, draps King) : colonne à part.
alter table public.bien_lit add column if not exists linge text check (linge is null or char_length(linge) between 1 and 20);
alter table public.bien_lit add column if not exists transforme_linge text check (transforme_linge is null or char_length(transforme_linge) between 1 and 20);
comment on column public.bien_lit.linge is 'Taille du linge de lit dans le vocabulaire de l''équipe (King, Queen, Twin ; « Twin/Queen » = drap Twin + housse Queen) : « 1 Drap King + 1 Housse King ». 429.';

create or replace function public.couchage_detail(p_bien uuid, p_lits jsonb) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare
  r record; v_mode text; v_type text; v_n int; v_larg int; v_lg text; v_places int := 0; v_jeux int := 0;
  v_grands int := 0; v_petits int := 0; v_canapes int := 0; v_sup int := 0; v_app int := 0; v_tr boolean;
  v_draps jsonb := '{}'::jsonb; v_taille text; v_pieces jsonb := '[]'::jsonb; v_cons text[] := '{}'; v_el text; k int; v_q int;
  pl jsonb; lae jsonb;
  fr text; en text; es text;
begin
  for r in select l.* from bien_lit l where l.bien_id = p_bien and l.actif
             and l.id in (select (e->>'lit_id')::uuid from jsonb_array_elements(coalesce(p_lits, '[]'::jsonb)) e where (e->>'lit_id') ~ '^[0-9a-f-]{36}$')
           order by l.ordre, l.piece, l.id loop
    select coalesce(e->>'mode', 'normal') into v_mode from jsonb_array_elements(p_lits) e where e->>'lit_id' = r.id::text limit 1;
    v_tr := v_mode = 'transforme' and r.transforme_type is not null;
    if v_tr then
      v_type := r.transforme_type; v_n := r.transforme_nombre; v_larg := r.transforme_largeur_cm; v_lg := coalesce(r.transforme_linge, case when r.transforme_type = 'simple' then 'Twin' end);
      v_cons := v_cons || format('%s : %s à installer en %s lit%s%s', r.piece,
        case when r.type in ('king', 'queen', 'double') then 'le grand lit' else 'le lit' end,
        v_n, case when v_n > 1 then 's' else '' end, case when v_larg is not null then ' ' || v_larg || '×' || r.longueur_cm else '' end);
    else
      v_type := r.type; v_n := 1; v_larg := r.largeur_cm; v_lg := r.linge;
    end if;
    v_taille := coalesce(v_lg, case when v_larg is not null then v_larg || '×' || r.longueur_cm end, case when v_type in ('simple', 'superpose', 'appoint') then 'simple (taille ?)' else 'grand lit (taille ?)' end);
    for k in 1..v_n loop
      v_q := case when v_type = 'superpose' then 2 else 1 end;
      v_jeux := v_jeux + v_q;
      v_draps := jsonb_set(v_draps, array[v_taille], to_jsonb(coalesce((v_draps->>v_taille)::int, 0) + v_q));
      if v_type = 'superpose' then v_places := v_places + coalesce(r.places, 2); v_sup := v_sup + 1;
      else
        v_places := v_places + case when v_tr then lit_places_defaut(v_type) else coalesce(r.places, lit_places_defaut(v_type)) end;
        if v_type = 'canape_lit' then v_canapes := v_canapes + 1;
        elsif v_type = 'appoint' then v_app := v_app + 1;
        elsif v_type = 'simple' then v_petits := v_petits + 1;
        else v_grands := v_grands + 1; end if;
      end if;
    end loop;
    v_el := v_n || ' ' ||
      case v_type when 'simple' then 'petit' || case when v_n > 1 then 's lits' else ' lit' end
                  when 'canape_lit' then 'canapé' || case when v_n > 1 then 's-lits' else '-lit' end
                  when 'superpose' then 'lits superposés' when 'appoint' then 'couchage' || case when v_n > 1 then 's' else '' end || ' d''appoint'
                  else 'grand' || case when v_n > 1 then 's lits' else ' lit' end end
      || case when v_larg is not null then ' ' || v_larg || '×' || r.longueur_cm else '' end
      || case when v_lg is not null then ' (draps ' || v_lg || ')' else '' end;
    v_pieces := v_pieces || jsonb_build_object('piece', r.piece, 'fr', v_el);
  end loop;
  fr := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || ' grand' || case when v_grands > 1 then 's lits' else ' lit' end end,
    case when v_petits > 0 then v_petits || ' petit' || case when v_petits > 1 then 's lits' else ' lit' end end,
    case when v_sup > 0 then v_sup || ' lits superposés' end,
    case when v_canapes > 0 then v_canapes || ' canapé' || case when v_canapes > 1 then 's-lits' else '-lit' end end,
    case when v_app > 0 then v_app || ' couchage' || case when v_app > 1 then 's' else '' end || ' d''appoint' end], null), ' + ');
  en := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || ' large bed' || case when v_grands > 1 then 's' else '' end end,
    case when v_petits > 0 then v_petits || ' single bed' || case when v_petits > 1 then 's' else '' end end,
    case when v_sup > 0 then v_sup || ' bunk bed' || case when v_sup > 1 then 's' else '' end end,
    case when v_canapes > 0 then v_canapes || ' sofa bed' || case when v_canapes > 1 then 's' else '' end end,
    case when v_app > 0 then v_app || ' extra bed' || case when v_app > 1 then 's' else '' end end], null), ' + ');
  es := array_to_string(array_remove(array[
    case when v_grands > 0 then v_grands || case when v_grands > 1 then ' camas grandes' else ' cama grande' end end,
    case when v_petits > 0 then v_petits || case when v_petits > 1 then ' camas individuales' else ' cama individual' end end,
    case when v_sup > 0 then v_sup || ' litera' || case when v_sup > 1 then 's' else '' end end,
    case when v_canapes > 0 then v_canapes || case when v_canapes > 1 then ' sofás cama' else ' sofá cama' end end,
    case when v_app > 0 then v_app || case when v_app > 1 then ' camas supletorias' else ' cama supletoria' end end], null), ' + ');
  select coalesce(jsonb_agg(jsonb_build_object('taille', key, 'qte', value::int) order by key), '[]'::jsonb),
         -- Libellés de l'équipe : « 1 Drap King + 1 Housse King »
         coalesce(jsonb_agg(to_jsonb(case when key ~ '(taille \?)' or key ~ '^\d' then value || ' jeu' || case when value::int > 1 then 'x' else '' end || ' de draps ' || key
                                          -- « Twin/Queen » = drap Twin, housse Queen (ex. IBANETA)
                                          when key ~ '/' then value || ' Drap' || case when value::int > 1 then 's' else '' end || ' ' || split_part(key, '/', 1) || ' + ' || value || ' Housse' || case when value::int > 1 then 's' else '' end || ' ' || split_part(key, '/', 2)
                                          else value || ' Drap' || case when value::int > 1 then 's' else '' end || ' ' || key || ' + ' || value || ' Housse' || case when value::int > 1 then 's' else '' end || ' ' || key end) order by key), '[]'::jsonb)
    into pl, lae from jsonb_each_text(v_draps);
  return jsonb_build_object('places', v_places, 'lits', v_jeux, 'draps', pl, 'linge_lignes', lae, 'grands', v_grands, 'petits', v_petits, 'canapes', v_canapes, 'superposes', v_sup,
    'texte', jsonb_build_object('fr', fr, 'en', en, 'es', es), 'pieces', v_pieces,
    'consigne_auto', nullif(array_to_string(v_cons, ' ; '), ''));
end $$;

-- Référence des sacs de linge (feuilles de préparation de l'équipe, PDF du 15/10/2026) : une fiche par sac, même format
-- que l'étiquette (code du bien en gros + contenu) → impression d'étiquettes possible plus tard.
create table if not exists public.bien_sac_preparation (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid references public.bien(id) on delete set null,
  etiquette text,
  sous_etiquette text,
  blocs jsonb not null default '[]'::jsonb check (jsonb_typeof(blocs) = 'array'),   -- [{titre, lignes:[…]}] (titre null = bloc sans titre)
  regles_pax jsonb not null default '[]'::jsonb check (jsonb_typeof(regles_pax) = 'array'), -- [{pax_min, texte, lignes:[…]}]
  ordre smallint not null default 100,
  actif boolean not null default true,
  source text not null default 'saisi',
  note text,
  maj_le timestamptz not null default now(),
  maj_par text
);
create index if not exists bien_sac_preparation_bien on public.bien_sac_preparation (bien_id);
comment on table public.bien_sac_preparation is 'Contenu des sacs de linge / produits par bien (vocabulaire de l''équipe), une ligne par sac étiqueté. Source : feuilles de préparation (PDF). Base de l''impression d''étiquettes. 429.';
alter table public.bien_sac_preparation enable row level security;
drop policy if exists bien_sac_preparation_staff on public.bien_sac_preparation;
create policy bien_sac_preparation_staff on public.bien_sac_preparation for all to authenticated
  using (auth_user_is_staff() and (bien_id is null or my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (bien_id is null or my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.bien_sac_preparation from anon;
grant select, insert, update on public.bien_sac_preparation to authenticated;
grant all on public.bien_sac_preparation to service_role;

-- ═══ 429c (appliquée) ═══
-- 429c — Contenu du sac de référence (feuille de préparation) pour l'AE / le staff, par mission (Ma journée, hub).
create or replace function public.terrain_sacs_preparation(p_mission_ids uuid[])
returns table (mission_id uuid, etiquette text, sous_etiquette text, blocs jsonb, regles_pax jsonb)
language sql stable security definer set search_path to 'public' as $$
  select m.id, s.etiquette, s.sous_etiquette, s.blocs, s.regles_pax
  from mission_menage m join bien_sac_preparation s on s.bien_id = m.bien_id and s.actif
  where m.id = any(p_mission_ids)
    and (auth_user_owns_ae(m.ae_id) or auth_user_is_bureau()
         or (auth_user_is_staff() and (my_secteurs() is null or m.bien_id in (select my_scoped_bien_ids()))))
  order by m.id, s.ordre $$;
revoke all on function public.terrain_sacs_preparation(uuid[]) from public, anon;
grant execute on function public.terrain_sacs_preparation(uuid[]) to authenticated, service_role;
