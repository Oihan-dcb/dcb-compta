-- 481 — Inventaire complet pièce par pièce (19/10/2026, décisions Oïhan du 19/10)
--
-- Modèle (réutilise inventaire_bien_config / inventaire_bien_stock / inventaire_mouvements, clé = bien_toolbox.id) :
--   * inventaire_piece : pièces du bien, GÉNÉRÉES automatiquement (entrée, séjour, cuisine, chaque chambre de
--     bien_lit sinon des chambres Hospitable, chaque salle de bain / WC Hospitable, linge & rangements, extérieur
--     si piscine / jardin / terrasse) puis ajustées par l'intervenante au 1er inventaire (ajouter, renommer,
--     retirer, déplacer un article) ou par le bureau.
--   * inventaire_bien_config.piece_id (pièce de l'article, pré-rangée par catégorie) et .quantite_attendue
--     (quantité de référence : couverts, vaisselle, linge… ; null = jamais comptée → le 1er comptage la fixe).
--   * inventaire_releve : un inventaire complet (planifié par le bureau → en cours → terminé), lié à la mission
--     (mission_menage) et/ou à la tâche Hospitable créée par le bureau (hospitable_task_id = ical_uid de la
--     mission), ou à un extra prévu « inventaire » (mission_extra_prevu, migration 476).
--   * inventaire_releve_ligne : par article VU : présent / manquant / abîmé, quantité constatée vs attendue,
--     état en clair (« poêle rayée »), photo obligatoire si manquant ou abîmé (prise pendant la mission :
--     contrôle côté portail, même règle que les preuves d'entretien).
--   * inventaire_releve_piece : commentaire et « pièce terminée » par pièce.
--   * bien_toolbox.inventaire_complet_at : date du dernier inventaire complet (≥ 90 % des articles vus).
-- Chaque article noté met aussi à jour le suivi existant (inventaire_bien_stock + inventaire_mouvements) :
-- manquant / abîmé → « manquant » / « à remplacer » → sac du prochain passage (déclencheur 332, inchangé).
--
-- Paiement (décision Oïhan : l'inventaire est payé par le PROPRIÉTAIRE) :
--   * type de prestation « Inventaire » (créé par 476 en dcb_direct par prudence) → imputation par défaut
--     deduction_loy ;
--   * mission dédiée (tâche Hospitable « Maintenance » : hors séjour, les extras SONT le paiement, règle 320) :
--     « Inventaire terminé » crée la prestation_hors_forfait EN ATTENTE type Inventaire, deduction_loy, montant =
--     durée × taux horaire de l'AE (même règle que extra_prevu_fait / creerExtraTerrain), validée par le bureau
--     dans Gestion comme les autres extras ;
--   * inventaire demandé en extra prévu sur une mission : extra_prevu_fait (476) — imputation choisie par le bureau.
--   Tarif propriétaire spécifique : NON défini (à décider par Oïhan) ; aujourd'hui le propriétaire est refacturé
--   le montant payé à l'AE, comme le ménage de fond.
--
-- Contrôle non bloquant : inventaire_anomalie() → « inventaire non fait » / « inventaire incomplet : x % des
-- articles vus » (< 90 %) dans les anomalies du hub Missions (branché par 482 dans mission_hub_periode).

begin;

-- ── 1. Pièces ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventaire_piece (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien_toolbox(id),
  nom text not null check (length(trim(nom)) between 1 and 60),
  genre text not null default 'autre' check (genre in ('entree','sejour','cuisine','chambre','salle_de_bain','wc','rangement','exterieur','autre')),
  ordre integer not null default 500,
  source text not null default 'auto' check (source in ('auto','intervenant','bureau')),
  actif boolean not null default true,
  cree_par_ae_id uuid references public.auto_entrepreneur(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventaire_piece_bien_idx on public.inventaire_piece (bien_id) where actif;
comment on table public.inventaire_piece is
  'Pièces d''un bien pour l''inventaire (481). bien_id = bien_toolbox.id. Générées automatiquement (_inventaire_pieces_generer), ajustées par l''intervenante (RPC) ou le bureau.';
alter table public.inventaire_piece enable row level security;
drop policy if exists inventaire_piece_lecture on public.inventaire_piece;
create policy inventaire_piece_lecture on public.inventaire_piece for select to authenticated using (auth_user_is_internal());
drop policy if exists inventaire_piece_bureau on public.inventaire_piece;
create policy inventaire_piece_bureau on public.inventaire_piece for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());

alter table public.inventaire_bien_config add column if not exists piece_id uuid references public.inventaire_piece(id) on delete set null;
alter table public.inventaire_bien_config add column if not exists quantite_attendue integer check (quantite_attendue is null or quantite_attendue between 0 and 999);
comment on column public.inventaire_bien_config.quantite_attendue is
  'Quantité de référence pour l''inventaire complet (481). null = jamais comptée : le 1er comptage la fixe ; modifiable par le bureau.';

alter table public.bien_toolbox add column if not exists inventaire_complet_at timestamptz;
alter table public.bien_toolbox add column if not exists inventaire_complet_releve_id uuid;
comment on column public.bien_toolbox.inventaire_complet_at is 'Date du dernier inventaire complet terminé avec au moins 90 % des articles vus (481).';

-- ── 2. Relevés ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventaire_releve (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien_toolbox(id),
  statut text not null default 'planifie' check (statut in ('planifie','en_cours','termine','annule')),
  origine text not null default 'mission' check (origine in ('mission','extra','spontane')),
  mission_id uuid references public.mission_menage(id) on delete set null,
  hospitable_task_id text,
  extra_prevu_id uuid references public.mission_extra_prevu(id) on delete set null,
  ae_id uuid references public.auto_entrepreneur(id) on delete set null,
  date_prevue date,
  duree_prevue_minutes integer check (duree_prevue_minutes is null or duree_prevue_minutes between 15 and 960),
  consignes text check (consignes is null or length(consignes) <= 2000),
  debut_at timestamptz,
  fin_at timestamptz,
  duree_minutes integer,
  nb_articles integer, nb_vus integer, nb_manquants integer, nb_abimes integer, nb_ecarts_quantite integer,
  taux_vus numeric(5,1),
  commentaire text,
  prestation_id uuid references public.prestation_hors_forfait(id) on delete set null,
  cree_par_nom text,
  annule_le timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventaire_releve_bien_idx on public.inventaire_releve (bien_id, created_at desc);
create index if not exists inventaire_releve_mission_idx on public.inventaire_releve (mission_id);
create unique index if not exists inventaire_releve_task_uniq on public.inventaire_releve (hospitable_task_id) where hospitable_task_id is not null and statut <> 'annule';
comment on table public.inventaire_releve is
  'Inventaire complet d''un bien (481) : planifié par le bureau (tâche Hospitable hospitable_task_id ou extra prévu) → en cours → terminé. Les lignes sont dans inventaire_releve_ligne.';
alter table public.inventaire_releve enable row level security;
drop policy if exists inventaire_releve_lecture on public.inventaire_releve;
create policy inventaire_releve_lecture on public.inventaire_releve for select to authenticated using (
  auth_user_is_staff()
  or auth_user_owns_ae(ae_id)
  or exists (select 1 from public.mission_menage m
              where (m.id = inventaire_releve.mission_id
                     or (inventaire_releve.hospitable_task_id is not null and m.ical_uid = inventaire_releve.hospitable_task_id || '@smartbnb.io'))
                and auth_user_owns_ae(m.ae_id))
);
-- Bureau : planifier (insert statut planifie) et annuler. L'intervenante passe uniquement par les RPC.
drop policy if exists inventaire_releve_bureau_insert on public.inventaire_releve;
create policy inventaire_releve_bureau_insert on public.inventaire_releve for insert to authenticated
  with check (auth_user_is_staff() and statut = 'planifie');
drop policy if exists inventaire_releve_bureau_update on public.inventaire_releve;
create policy inventaire_releve_bureau_update on public.inventaire_releve for update to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());

create table if not exists public.inventaire_releve_ligne (
  id uuid primary key default gen_random_uuid(),
  releve_id uuid not null references public.inventaire_releve(id) on delete cascade,
  item_id uuid not null references public.catalogue_items(id),
  piece_id uuid references public.inventaire_piece(id) on delete set null,
  etat text not null check (etat in ('present','manquant','abime')),
  quantite_attendue integer,
  quantite_constatee integer check (quantite_constatee is null or quantite_constatee between 0 and 999),
  etat_note text check (etat_note is null or length(etat_note) <= 300),
  photo_url text,
  vu_at timestamptz not null default now(),
  unique (releve_id, item_id)
);
alter table public.inventaire_releve_ligne enable row level security;
drop policy if exists inventaire_releve_ligne_lecture on public.inventaire_releve_ligne;
create policy inventaire_releve_ligne_lecture on public.inventaire_releve_ligne for select to authenticated using (
  exists (select 1 from public.inventaire_releve r where r.id = inventaire_releve_ligne.releve_id
           and (auth_user_is_staff() or auth_user_owns_ae(r.ae_id))));

create table if not exists public.inventaire_releve_piece (
  releve_id uuid not null references public.inventaire_releve(id) on delete cascade,
  piece_id uuid not null references public.inventaire_piece(id) on delete cascade,
  commentaire text check (commentaire is null or length(commentaire) <= 1000),
  terminee_at timestamptz,
  primary key (releve_id, piece_id)
);
alter table public.inventaire_releve_piece enable row level security;
drop policy if exists inventaire_releve_piece_lecture on public.inventaire_releve_piece;
create policy inventaire_releve_piece_lecture on public.inventaire_releve_piece for select to authenticated using (
  exists (select 1 from public.inventaire_releve r where r.id = inventaire_releve_piece.releve_id
           and (auth_user_is_staff() or auth_user_owns_ae(r.ae_id))));

-- ── 3. Type de mission terrain « inventaire » (Ma journée) ───────────────────────────────────
alter table public.mission_terrain drop constraint if exists mission_terrain_type_terrain_check;
alter table public.mission_terrain add constraint mission_terrain_type_terrain_check
  check (type_terrain = any (array['menage','check_in','recouche','demande_menage','technique','inventaire']));

-- ── 4. Paiement : l'inventaire est refacturé au propriétaire (décision Oïhan 19/10/2026) ─────
update public.prestation_type set type_imputation_defaut = 'deduction_loy',
       description = 'Inventaire complet du logement (mission dédiée ou extra prévu) — refacturé au propriétaire'
 where lower(trim(nom)) = 'inventaire';

-- ── 5. Génération des pièces + pré-rangement des articles ────────────────────────────────────
create or replace function public._inventaire_genre_article(p_categorie text, p_nom text)
returns text language sql immutable as $$
  select case
    when p_nom ~* '(s[eè]che-cheveux|poubelle de sdb|brosse toilettes|distributeur savon|porte-savon|miroir|s[eè]che-serviettes|p[eè]se-personne)' then 'salle_de_bain'
    when p_nom ~* '(aspirateur|fer [aà] repasser|table [aà] repasser|planche [aà] repasser|[eé]tendoir|machine [aà] laver|s[eè]che-linge)' then 'rangement'
    when p_categorie = 'Literie' or p_nom ~* '(serviettes de bain|serviettes de toilette|peignoirs|gants de toilette|tapis de bain|chaussons)' then 'rangement'
    when p_categorie in ('Couverts','Ustensiles','Vaisselle','Cuisine')
      or p_nom ~* '(r[ée]frig[ée]rateur|micro-ondes|bouilloire|grille-pain|mixeur|cafeti[eè]re|cong[ée]lateur|four|lave-vaisselle|chaises hautes)' then 'cuisine'
    when p_categorie = 'Salle de bain' then 'salle_de_bain'
    when p_categorie = 'Extérieur' then 'exterieur'
    when p_categorie = 'Sécurité' then 'entree'
    else 'sejour' end
$$;

create or replace function public._inventaire_pieces_generer(p_tbx uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  b bien; v_bien uuid; chambres text[]; rooms jsonb; nb int; i int; n_ranges int;
begin
  select bien_id into v_bien from bien_toolbox where id = p_tbx;
  if not found then raise exception 'fiche_bien_introuvable'; end if;
  if not exists (select 1 from inventaire_piece where bien_id = p_tbx and actif) then
    select * into b from bien where id = v_bien;
    rooms := case when jsonb_typeof(b.hospitable_room_details) = 'array' then b.hospitable_room_details else '[]'::jsonb end;
    insert into inventaire_piece (bien_id, nom, genre, ordre) values
      (p_tbx, 'Entrée', 'entree', 10), (p_tbx, 'Séjour', 'sejour', 20), (p_tbx, 'Cuisine', 'cuisine', 30);
    -- Chambres : d'abord la saisie des couchages (bien_lit), sinon les chambres déclarées dans Hospitable
    select array_agg(piece order by o, piece) into chambres from (
      select piece, min(ordre) o from bien_lit where bien_id = v_bien and actif and piece ~* '(chambre|suite)' group by piece) x;
    if chambres is null then
      nb := (select count(*) from jsonb_array_elements(rooms) r where r->>'type' = 'bedroom');
      if nb = 1 then chambres := array['Chambre'];
      elsif nb > 1 then chambres := (select array_agg('Chambre ' || g order by g) from generate_series(1, nb) g); end if;
    end if;
    for i in 1..coalesce(array_length(chambres, 1), 0) loop
      insert into inventaire_piece (bien_id, nom, genre, ordre) values (p_tbx, chambres[i], 'chambre', 100 + i);
    end loop;
    if exists (select 1 from bien_lit where bien_id = v_bien and actif and piece ~* 'bureau')
       or exists (select 1 from jsonb_array_elements(rooms) r where r->>'type' = 'office') then
      insert into inventaire_piece (bien_id, nom, genre, ordre) values (p_tbx, 'Bureau', 'autre', 150);
    end if;
    nb := greatest(1, (select count(*) from jsonb_array_elements(rooms) r where r->>'type' = 'full_bathroom')::int);
    for i in 1..nb loop
      insert into inventaire_piece (bien_id, nom, genre, ordre) values (p_tbx, case when nb = 1 then 'Salle de bain' else 'Salle de bain ' || i end, 'salle_de_bain', 200 + i);
    end loop;
    nb := (select count(*) from jsonb_array_elements(rooms) r where r->>'type' = 'half_bathroom')::int;
    for i in 1..nb loop
      insert into inventaire_piece (bien_id, nom, genre, ordre) values (p_tbx, case when nb = 1 then 'WC' else 'WC ' || i end, 'wc', 250 + i);
    end loop;
    insert into inventaire_piece (bien_id, nom, genre, ordre) values (p_tbx, 'Linge & rangements', 'rangement', 300);
    if coalesce(b.a_piscine, false)
       or exists (select 1 from jsonb_array_elements(rooms) r where r->>'type' in ('exterior','patio','backyard','terrace','balcony','pool','garage'))
       or exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = p_tbx and c.actif and ci.categorie = 'Extérieur' and ci.type in ('equipement','petit_equipement')) then
      insert into inventaire_piece (bien_id, nom, genre, ordre) values (p_tbx, 'Extérieur', 'exterieur', 400);
    end if;
  end if;
  -- Articles pas encore rangés : pièce du genre voulu (la première), sinon le séjour, sinon la première pièce.
  update inventaire_bien_config c set piece_id = coalesce(
      (select p.id from inventaire_piece p where p.bien_id = p_tbx and p.actif and p.genre = _inventaire_genre_article(ci.categorie, ci.nom) order by p.ordre, p.nom limit 1),
      (select p.id from inventaire_piece p where p.bien_id = p_tbx and p.actif and p.genre = 'sejour' order by p.ordre limit 1),
      (select p.id from inventaire_piece p where p.bien_id = p_tbx and p.actif order by p.ordre limit 1))
    from catalogue_items ci
   where ci.id = c.item_id and c.bien_id = p_tbx and c.actif and c.piece_id is null and ci.type in ('equipement','petit_equipement');
  get diagnostics n_ranges = row_count;
  return n_ranges;
end $$;
revoke all on function public._inventaire_pieces_generer(uuid) from public, anon, authenticated;

-- Bureau (fiche bien) : générer / compléter le rangement.
create or replace function public.inventaire_pieces_generer(p_tbx uuid)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not auth_user_is_staff() then raise exception 'reserve_bureau'; end if;
  return _inventaire_pieces_generer(p_tbx);
end $$;
revoke all on function public.inventaire_pieces_generer(uuid) from public, anon;
grant execute on function public.inventaire_pieces_generer(uuid) to authenticated;

-- ── 6. Parcours de l'intervenante (Ma journée) ───────────────────────────────────────────────
create or replace function public._inventaire_releve_check(p_releve uuid)
returns inventaire_releve language plpgsql security definer set search_path = public as $$
declare r inventaire_releve;
begin
  select * into r from inventaire_releve where id = p_releve;
  if not found then raise exception 'inventaire_introuvable'; end if;
  if not auth_user_owns_ae(r.ae_id) then raise exception 'inventaire_hors_perimetre'; end if;
  if r.statut <> 'en_cours' then raise exception 'inventaire_pas_en_cours'; end if;
  return r;
end $$;
revoke all on function public._inventaire_releve_check(uuid) from public, anon, authenticated;

-- Démarrer (ou reprendre) l'inventaire d'une mission EN COURS. Rattache l'inventaire planifié par le bureau
-- (tâche Hospitable de la mission, ou extra prévu « inventaire »), sinon en crée un si la mission est de type
-- inventaire. Génère les pièces au besoin. Renvoie l'id du relevé.
create or replace function public.inventaire_demarrer(p_mission_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m mission_menage; t mission_terrain; v_tbx uuid; v uuid; v_task text; v_extra uuid;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.started_at is null or t.ended_at is not null then raise exception 'mission_pas_en_cours'; end if;
  select id into v_tbx from bien_toolbox where bien_id = m.bien_id order by (archived_at is null) desc limit 1;
  if v_tbx is null then raise exception 'fiche_bien_introuvable'; end if;
  select id into v from inventaire_releve where mission_id = m.id and statut in ('en_cours','termine') order by created_at desc limit 1;
  if v is not null then return v; end if;
  v_task := case when m.ical_uid ~* '@smartbnb\.io$' then split_part(m.ical_uid, '@', 1) end;
  select id into v_extra from mission_extra_prevu where mission_id = m.id and genre = 'inventaire' and statut = 'prevu' order by created_at limit 1;
  select id into v from inventaire_releve
   where statut = 'planifie' and (mission_id = m.id or (v_task is not null and hospitable_task_id = v_task))
   order by created_at limit 1;
  if v is not null then
    update inventaire_releve set mission_id = m.id, ae_id = m.ae_id, statut = 'en_cours', debut_at = now(),
           extra_prevu_id = coalesce(extra_prevu_id, v_extra), updated_at = now()
     where id = v;
  else
    if v_extra is null and coalesce(t.type_terrain, '') <> 'inventaire' then raise exception 'pas_d_inventaire_prevu'; end if;
    insert into inventaire_releve (bien_id, statut, origine, mission_id, hospitable_task_id, extra_prevu_id, ae_id, date_prevue, debut_at)
    values (v_tbx, 'en_cours', case when v_extra is not null then 'extra' else 'mission' end, m.id, v_task, v_extra, m.ae_id, m.date_mission, now())
    returning id into v;
  end if;
  perform _inventaire_pieces_generer(v_tbx);
  return v;
end $$;
revoke all on function public.inventaire_demarrer(uuid) from public, anon;
grant execute on function public.inventaire_demarrer(uuid) to authenticated;

-- Noter un article vu. Photo obligatoire si manquant ou abîmé (déjà envoyée par le portail : URL).
-- Met à jour le suivi existant (stock + mouvement) → sac automatique (332) si manquant / à remplacer.
create or replace function public.inventaire_noter(p_releve uuid, p_item uuid, p_etat text, p_quantite integer default null,
                                                   p_note text default null, p_photo_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r inventaire_releve; c inventaire_bien_config; ci catalogue_items; l inventaire_releve_ligne; s inventaire_bien_stock;
  v_photo text; v_qte int; v_statut text; v_attendue int;
begin
  r := _inventaire_releve_check(p_releve);
  if p_etat not in ('present','manquant','abime') then raise exception 'etat_invalide'; end if;
  select * into c from inventaire_bien_config where bien_id = r.bien_id and item_id = p_item and actif;
  if not found then raise exception 'article_hors_inventaire'; end if;
  select * into ci from catalogue_items where id = p_item;
  select * into l from inventaire_releve_ligne where releve_id = r.id and item_id = p_item;
  v_photo := coalesce(nullif(trim(p_photo_url), ''), l.photo_url);
  if p_etat in ('manquant','abime') and v_photo is null then raise exception 'photo_obligatoire'; end if;
  v_qte := case when p_etat = 'manquant' and p_quantite is null then 0 else p_quantite end;
  if v_qte is not null and (v_qte < 0 or v_qte > 999) then raise exception 'quantite_invalide'; end if;
  -- 1er comptage : la quantité constatée devient la référence (le bureau peut la corriger).
  v_attendue := c.quantite_attendue;
  if v_attendue is null and v_qte is not null and p_etat = 'present' then
    v_attendue := v_qte;
    update inventaire_bien_config set quantite_attendue = v_qte where id = c.id;
  end if;
  insert into inventaire_releve_ligne (releve_id, item_id, piece_id, etat, quantite_attendue, quantite_constatee, etat_note, photo_url, vu_at)
  values (r.id, p_item, c.piece_id, p_etat, v_attendue, v_qte, nullif(left(trim(coalesce(p_note, '')), 300), ''), v_photo, now())
  on conflict (releve_id, item_id) do update set piece_id = excluded.piece_id, etat = excluded.etat, quantite_attendue = excluded.quantite_attendue,
     quantite_constatee = excluded.quantite_constatee, etat_note = excluded.etat_note, photo_url = excluded.photo_url, vu_at = now();
  -- Suivi existant (mêmes statuts que l'inventaire du portail et de PowerHouse)
  v_statut := case p_etat when 'manquant' then 'manquant' when 'abime' then 'a_remplacer'
                else case when v_attendue is not null and v_qte is not null and v_qte < v_attendue then 'a_remplacer' else 'present' end end;
  select * into s from inventaire_bien_stock where bien_id = r.bien_id and item_id = p_item;
  insert into inventaire_bien_stock (bien_id, item_id, statut, quantite, derniere_maj_par, derniere_maj_at)
  values (r.bien_id, p_item, v_statut, v_qte, r.ae_id, now())
  on conflict (bien_id, item_id) do update set statut = excluded.statut, quantite = coalesce(excluded.quantite, inventaire_bien_stock.quantite),
     derniere_maj_par = excluded.derniere_maj_par, derniere_maj_at = now();
  if s.statut is distinct from v_statut then
    insert into inventaire_mouvements (bien_id, item_id, ancien_statut, nouveau_statut, auteur_ae_id, note)
    values (r.bien_id, p_item, s.statut, v_statut, r.ae_id, 'Inventaire complet' || coalesce(' — ' || nullif(trim(p_note), ''), ''));
  end if;
  return jsonb_build_object('etat', p_etat, 'statut_suivi', v_statut, 'quantite_attendue', v_attendue, 'quantite_constatee', v_qte);
end $$;
revoke all on function public.inventaire_noter(uuid, uuid, text, integer, text, text) from public, anon;
grant execute on function public.inventaire_noter(uuid, uuid, text, integer, text, text) to authenticated;

-- Pièces : ajouter / renommer / retirer (articles reportés au séjour), déplacer un article, commentaire par pièce.
create or replace function public.inventaire_piece_ajouter(p_releve uuid, p_nom text, p_genre text default 'autre')
returns uuid language plpgsql security definer set search_path = public as $$
declare r inventaire_releve; v uuid;
begin
  r := _inventaire_releve_check(p_releve);
  if length(trim(coalesce(p_nom, ''))) < 1 then raise exception 'nom_obligatoire'; end if;
  insert into inventaire_piece (bien_id, nom, genre, ordre, source, cree_par_ae_id)
  values (r.bien_id, left(trim(p_nom), 60), case when p_genre in ('entree','sejour','cuisine','chambre','salle_de_bain','wc','rangement','exterieur') then p_genre else 'autre' end,
          coalesce((select max(ordre) from inventaire_piece where bien_id = r.bien_id and actif), 0) + 10, 'intervenant', r.ae_id)
  returning id into v;
  return v;
end $$;
revoke all on function public.inventaire_piece_ajouter(uuid, text, text) from public, anon;
grant execute on function public.inventaire_piece_ajouter(uuid, text, text) to authenticated;

create or replace function public.inventaire_piece_modifier(p_releve uuid, p_piece uuid, p_nom text default null, p_retirer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r inventaire_releve; p inventaire_piece; v_dest uuid;
begin
  r := _inventaire_releve_check(p_releve);
  select * into p from inventaire_piece where id = p_piece and bien_id = r.bien_id and actif;
  if not found then raise exception 'piece_introuvable'; end if;
  if p_retirer then
    select id into v_dest from inventaire_piece where bien_id = r.bien_id and actif and id <> p.id order by (genre = 'sejour') desc, ordre limit 1;
    if v_dest is null then raise exception 'derniere_piece'; end if;
    update inventaire_bien_config set piece_id = v_dest where bien_id = r.bien_id and piece_id = p.id;
    update inventaire_piece set actif = false, updated_at = now() where id = p.id;
  elsif length(trim(coalesce(p_nom, ''))) >= 1 then
    update inventaire_piece set nom = left(trim(p_nom), 60), updated_at = now() where id = p.id;
  end if;
end $$;
revoke all on function public.inventaire_piece_modifier(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.inventaire_piece_modifier(uuid, uuid, text, boolean) to authenticated;

create or replace function public.inventaire_article_deplacer(p_releve uuid, p_item uuid, p_piece uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r inventaire_releve;
begin
  r := _inventaire_releve_check(p_releve);
  if not exists (select 1 from inventaire_piece where id = p_piece and bien_id = r.bien_id and actif) then raise exception 'piece_introuvable'; end if;
  update inventaire_bien_config set piece_id = p_piece where bien_id = r.bien_id and item_id = p_item and actif;
  update inventaire_releve_ligne set piece_id = p_piece where releve_id = r.id and item_id = p_item;
end $$;
revoke all on function public.inventaire_article_deplacer(uuid, uuid, uuid) from public, anon;
grant execute on function public.inventaire_article_deplacer(uuid, uuid, uuid) to authenticated;

create or replace function public.inventaire_piece_commenter(p_releve uuid, p_piece uuid, p_commentaire text, p_terminee boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare r inventaire_releve;
begin
  r := _inventaire_releve_check(p_releve);
  if not exists (select 1 from inventaire_piece where id = p_piece and bien_id = r.bien_id) then raise exception 'piece_introuvable'; end if;
  insert into inventaire_releve_piece (releve_id, piece_id, commentaire, terminee_at)
  values (r.id, p_piece, nullif(left(trim(coalesce(p_commentaire, '')), 1000), ''), case when p_terminee then now() end)
  on conflict (releve_id, piece_id) do update set
    commentaire = case when p_commentaire is null then inventaire_releve_piece.commentaire else excluded.commentaire end,
    terminee_at = case when p_terminee is null then inventaire_releve_piece.terminee_at when p_terminee then coalesce(inventaire_releve_piece.terminee_at, now()) else null end;
end $$;
revoke all on function public.inventaire_piece_commenter(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.inventaire_piece_commenter(uuid, uuid, text, boolean) to authenticated;

-- « Inventaire terminé » : chiffres, date du dernier inventaire complet (≥ 90 % vus) et paiement.
create or replace function public.inventaire_terminer(p_releve uuid, p_duree_min integer default null, p_commentaire text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r inventaire_releve; m mission_menage; a auto_entrepreneur; pt prestation_type; x mission_extra_prevu;
  v_nb int; v_vus int; v_manq int; v_abim int; v_ecarts int; v_taux numeric; v_duree int; v_presta uuid; v_code text; v_taux_h int; v_res jsonb;
begin
  r := _inventaire_releve_check(p_releve);
  select count(*) into v_nb from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
   where c.bien_id = r.bien_id and c.actif and ci.type in ('equipement','petit_equipement');
  select count(*), count(*) filter (where etat = 'manquant'), count(*) filter (where etat = 'abime'),
         count(*) filter (where quantite_attendue is not null and quantite_constatee is not null and quantite_constatee < quantite_attendue)
    into v_vus, v_manq, v_abim, v_ecarts
    from inventaire_releve_ligne l where l.releve_id = r.id;
  v_taux := case when v_nb > 0 then round(100.0 * least(v_vus, v_nb) / v_nb, 1) else 100 end;
  v_duree := round(coalesce(p_duree_min, extract(epoch from (now() - r.debut_at)) / 60) / 5.0) * 5;
  v_duree := greatest(5, least(960, v_duree));
  if r.mission_id is not null then select * into m from mission_menage where id = r.mission_id; end if;
  -- Paiement : extra prévu « inventaire » → circuit 476 ; mission dédiée « Maintenance » → extra Inventaire.
  if r.extra_prevu_id is not null then select * into x from mission_extra_prevu where id = r.extra_prevu_id; end if;
  if x.id is not null and x.statut = 'prevu' then
    v_res := extra_prevu_fait(x.id, v_duree, 'Inventaire complet : ' || v_vus || ' / ' || v_nb || ' articles vus');
    v_presta := (v_res->>'prestation_id')::uuid;
  elsif m.id is not null and coalesce(m.titre_ical, '') like 'Maintenance%' and m.ae_id is not null then
    select * into pt from prestation_type where lower(trim(nom)) = 'inventaire' and actif limit 1;
    if pt.id is not null then
      select * into a from auto_entrepreneur where id = m.ae_id;
      select code into v_code from bien where id = m.bien_id;
      v_taux_h := case when v_code = '01' then 2000 else coalesce(a.taux_horaire, 2500) end;
      insert into prestation_hors_forfait (ae_id, mission_id, prestation_type_id, bien_id, date_prestation, duree_minutes, montant,
                                           type_imputation, description, statut, mois, reservation_id)
      values (m.ae_id, m.id, pt.id, m.bien_id, m.date_mission,
              case when pt.unite = 'forfait' then null else v_duree end,
              case when pt.unite = 'forfait' then coalesce(pt.taux_defaut, v_taux_h) else round(v_duree / 60.0 * v_taux_h) end,
              coalesce(pt.type_imputation_defaut, 'deduction_loy'),
              'Inventaire complet : ' || v_vus || ' / ' || v_nb || ' articles vus (' || v_manq || ' manquant(s), ' || v_abim || ' abîmé(s))',
              'en_attente', m.mois, null)
      returning id into v_presta;
    end if;
  end if;
  update inventaire_releve set statut = 'termine', fin_at = now(), duree_minutes = v_duree, nb_articles = v_nb, nb_vus = v_vus,
         nb_manquants = v_manq, nb_abimes = v_abim, nb_ecarts_quantite = v_ecarts, taux_vus = v_taux,
         commentaire = nullif(left(trim(coalesce(p_commentaire, '')), 2000), ''), prestation_id = v_presta, updated_at = now()
   where id = r.id;
  if v_taux >= 90 then
    update bien_toolbox set inventaire_complet_at = now(), inventaire_complet_releve_id = r.id where id = r.bien_id;
  end if;
  return jsonb_build_object('nb_articles', v_nb, 'nb_vus', v_vus, 'taux_vus', v_taux, 'manquants', v_manq, 'abimes', v_abim,
                            'ecarts', v_ecarts, 'duree_minutes', v_duree, 'prestation_id', v_presta, 'complet', v_taux >= 90);
end $$;
revoke all on function public.inventaire_terminer(uuid, integer, text) from public, anon;
grant execute on function public.inventaire_terminer(uuid, integer, text) to authenticated;

-- ── 7. Contrôle non bloquant pour le hub Missions ────────────────────────────────────────────
-- null si la mission n'est pas une mission d'inventaire ; sinon « inventaire non fait » ou
-- « inventaire incomplet : x % des articles vus » (< 90 %).
create or replace function public.inventaire_anomalie(p_mission_id uuid, p_ical_uid text, p_type_terrain text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_task text; r inventaire_releve; est_inv boolean;
begin
  v_task := case when p_ical_uid ~* '@smartbnb\.io$' then split_part(p_ical_uid, '@', 1) end;
  select * into r from inventaire_releve
   where statut <> 'annule' and (mission_id = p_mission_id or (v_task is not null and hospitable_task_id = v_task))
   order by (statut = 'termine') desc, created_at desc limit 1;
  est_inv := r.id is not null or coalesce(p_type_terrain, '') = 'inventaire'
          or exists (select 1 from mission_extra_prevu x where x.mission_id = p_mission_id and x.genre = 'inventaire' and x.statut <> 'annule');
  if not est_inv then return null; end if;
  if r.id is null or r.statut <> 'termine' then return 'inventaire non fait'; end if;
  if coalesce(r.taux_vus, 0) < 90 then return 'inventaire incomplet : ' || replace(trim(to_char(r.taux_vus, 'FM990D0')), '.', ',') || ' % des articles vus'; end if;
  return null;
end $$;
revoke all on function public.inventaire_anomalie(uuid, text, text) from public, anon;
grant execute on function public.inventaire_anomalie(uuid, text, text) to authenticated;

commit;
