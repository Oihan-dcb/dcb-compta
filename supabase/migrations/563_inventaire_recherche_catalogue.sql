-- 563 — Inventaire terrain en mode recherche (23/10/2026, retours de Claudine, décisions d'Oïhan)
--
-- 1. Clé de comparaison des noms d'articles (catalogue_cle_nom) : minuscules, sans accents, sans petits mots
--    (à, de, la…), au singulier (verres → verre, couteaux → couteau, bocaux → bocal), mots triés
--    (« Grande poêle » = « Poêle grande »). Colonne générée catalogue_items.cle_nom + index UNIQUE par agence :
--    deux articles actifs ne peuvent plus avoir le même nom « à l'accent / au pluriel près », quel que soit
--    l'écran qui écrit (portail AE, PowerHouse, API).
-- 2. Articles créés depuis le terrain : l'AE qui ne trouve pas un objet le crée (nom + catégorie). Il rejoint le
--    catalogue de TOUT LE MONDE, marqué « créé par <AE> le <date>, à vérifier » (a_verifier) pour le bureau.
--    RPC catalogue_article_creer : nom déjà existant → renvoie l'article existant (jamais de doublon) ; noms
--    proches → les propose d'abord (l'AE confirme « c'est un autre objet » pour créer quand même).
-- 3. Bureau (PowerHouse › Biens › 📦 Catalogue › À vérifier) : valider / renommer (catalogue_article_valider),
--    fusionner un doublon dans le bon article (catalogue_fusionner) : toutes les références rebasculent vers
--    l'article gardé ; l'article fusionné est conservé, masqué (fusionne_vers_id) — rien n'est supprimé.
-- 4. inventaire_noter(p_piece) : un article trouvé par la recherche et absent de la liste du logement y est ajouté
--    (inventaire_bien_config, pièce où il a été vu, added_by 'inventaire_ae') au moment où il est noté. Marche
--    aussi hors réseau : le relevé part de la file du téléphone avec la pièce.
-- 5. Catalogue complété (cuisine, entretien, décoration, mobilier…) sans doublon (insertion seulement si la clé
--    n'existe pas encore) : 212 → 278 articles le 23/10/2026, 0 clé en double.
-- Appliquée via MCP en 6 parties (563a colonnes, 563b créer/fusionner, 563c inventaire_noter, 563d catalogue,
-- 563e proches par mot commun, 563f contrainte added_by 'inventaire_ae').

-- ── 1. Clé de comparaison ─────────────────────────────────────────────────
create or replace function public.catalogue_cle_nom(p text)
returns text language sql immutable parallel safe as $$
  select coalesce(string_agg(distinct w, ' ' order by w), '')
  from (
    select case
      when t ~ '(eaux|eux|oux)$' and length(t) > 4 then left(t, -1)
      when t ~ 'aux$' and length(t) > 4 then left(t, -3) || 'al'
      when t ~ '[^s]s$' and length(t) > 3 then left(t, -1)
      else t end collate "C" as w
    from regexp_split_to_table(trim(regexp_replace(regexp_replace(regexp_replace(
           lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '\+', ' plus ', 'g'), '-(\s|$)', ' moins ', 'g'),
           '[^a-z0-9]+', ' ', 'g')), '\s+') as t
    where t <> '' and t not in ('a','au','aux','avec','de','du','des','d','l','la','le','les','en','et','pour','un','une','sur')
  ) x
$$;
comment on function public.catalogue_cle_nom(text) is
  '563 : clé de comparaison des noms du catalogue (sans accents, singulier, sans petits mots, mots triés). Même règle côté portail AE : src/lib/rechercheCatalogue.js';

-- ── Colonnes ──────────────────────────────────────────────────────────────
alter table public.catalogue_items
  add column if not exists cle_nom text generated always as (public.catalogue_cle_nom(nom)) stored,
  add column if not exists a_verifier boolean not null default false,
  add column if not exists cree_par_ae_id uuid references public.auto_entrepreneur(id) on delete set null,
  add column if not exists cree_par_label text,
  add column if not exists cree_depuis text,
  add column if not exists verifie_le timestamptz,
  add column if not exists verifie_par text,
  add column if not exists fusionne_vers_id uuid references public.catalogue_items(id),
  add column if not exists fusionne_le timestamptz;
comment on column public.catalogue_items.a_verifier is '563 : créé depuis le terrain (portail AE), à valider / renommer / fusionner par le bureau';
comment on column public.catalogue_items.fusionne_vers_id is '563 : doublon fusionné dans cet article (références rebasculées) ; la ligne reste pour l''historique, masquée partout';

create unique index if not exists catalogue_items_cle_nom_unique
  on public.catalogue_items (agence, cle_nom) where fusionne_vers_id is null;
create index if not exists catalogue_items_a_verifier_idx on public.catalogue_items (a_verifier) where a_verifier;

-- ── Articles proches d'un nom (doublons possibles) ────────────────────────
create or replace function public.catalogue_proches(p_nom text, p_limite int default 6)
returns table (id uuid, nom text, type text, categorie text, score real, identique boolean)
language sql stable security definer set search_path = public, extensions as $$
  with k as (select public.catalogue_cle_nom(p_nom) as cle)
  select ci.id, ci.nom, ci.type, ci.categorie,
         greatest(similarity(ci.cle_nom, k.cle), word_similarity(k.cle, ci.cle_nom), word_similarity(ci.cle_nom, k.cle))::real as score,
         ci.cle_nom = k.cle as identique
    from catalogue_items ci, k
   where auth_user_is_internal() and ci.fusionne_vers_id is null and ci.agence = 'DCB' and k.cle <> ''
     and (ci.cle_nom = k.cle
          or similarity(ci.cle_nom, k.cle) >= 0.45
          or word_similarity(k.cle, ci.cle_nom) >= 0.6
          or word_similarity(ci.cle_nom, k.cle) >= 0.6)
   order by (ci.cle_nom = k.cle) desc, 5 desc, ci.nom
   limit greatest(1, least(coalesce(p_limite, 6), 20))
$$;

-- ── Création d'un article depuis le terrain ───────────────────────────────
-- Catégories proposées à l'AE → type du catalogue (le bureau peut corriger ensuite).
create or replace function public.catalogue_article_creer(p_nom text, p_categorie text, p_confirme boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  a auto_entrepreneur; v_nom text; v_cle text; v_cat text; v_type text; ex catalogue_items; ci catalogue_items; v_proches jsonb; v_nb int;
begin
  if not auth_user_is_internal() then raise exception 'acces_refuse'; end if;
  select * into a from auto_entrepreneur where ae_user_id = auth.uid() and actif limit 1;
  v_nom := regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g');
  if length(v_nom) < 2 or length(v_nom) > 60 then raise exception 'nom_invalide'; end if;
  v_nom := upper(left(v_nom, 1)) || substr(v_nom, 2);
  v_cle := catalogue_cle_nom(v_nom);
  if v_cle = '' then raise exception 'nom_invalide'; end if;
  v_cat := coalesce(nullif(trim(p_categorie), ''), 'Général');
  v_type := case when v_cat in ('Vaisselle','Couverts','Ustensiles','Literie','Salle de bain','Entretien','Électroménager','Général') then 'petit_equipement'
                 when v_cat in ('Décoration','Mobilier','Confort','Extérieur','Sécurité','Gros électroménager') then 'equipement'
                 else null end;
  if v_type is null then raise exception 'categorie_invalide'; end if;
  if v_cat = 'Gros électroménager' then v_cat := 'Électroménager'; end if;

  -- Nom déjà existant (à l'accent / au pluriel / à l'ordre des mots près) : jamais de doublon, on renvoie l'existant
  select * into ex from catalogue_items where agence = 'DCB' and cle_nom = v_cle and fusionne_vers_id is null limit 1;
  if found then
    return jsonb_build_object('statut', 'existe', 'item', jsonb_build_object('id', ex.id, 'nom', ex.nom, 'type', ex.type, 'categorie', ex.categorie));
  end if;
  -- Noms proches : proposés d'abord (l'AE choisit l'un d'eux, ou confirme que c'est un autre objet)
  if not coalesce(p_confirme, false) then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nom', x.nom, 'type', x.type, 'categorie', x.categorie)), '[]'::jsonb)
      into v_proches from catalogue_proches(v_nom, 6) x where x.type in ('equipement', 'petit_equipement');
    if jsonb_array_length(v_proches) > 0 then
      return jsonb_build_object('statut', 'proches', 'proches', v_proches);
    end if;
  end if;
  -- Garde-fou : 30 créations par personne et par jour
  select count(*) into v_nb from catalogue_items
   where cree_depuis = 'inventaire' and created_at > now() - interval '1 day'
     and (cree_par_ae_id = a.id or (a.id is null and cree_par_label = 'bureau'));
  if v_nb >= 30 then raise exception 'trop_de_creations'; end if;

  begin
    insert into catalogue_items (nom, type, categorie, unite, agence, a_verifier, cree_par_ae_id, cree_par_label, cree_depuis)
    values (v_nom, v_type, v_cat, 'unité', 'DCB', true, a.id,
            coalesce(nullif(trim(coalesce(a.prenom, '') || ' ' || coalesce(left(a.nom, 1) || '.', '')), ''), 'bureau'), 'inventaire')
    returning * into ci;
  exception when unique_violation then
    select * into ex from catalogue_items where agence = 'DCB' and (cle_nom = v_cle or nom = v_nom) and fusionne_vers_id is null limit 1;
    return jsonb_build_object('statut', 'existe', 'item', jsonb_build_object('id', ex.id, 'nom', ex.nom, 'type', ex.type, 'categorie', ex.categorie));
  end;
  return jsonb_build_object('statut', 'cree', 'item', jsonb_build_object('id', ci.id, 'nom', ci.nom, 'type', ci.type, 'categorie', ci.categorie));
end $$;

-- ── Bureau : valider / renommer ───────────────────────────────────────────
create or replace function public.catalogue_article_valider(p_item uuid, p_nom text default null, p_categorie text default null, p_type text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ci catalogue_items; v_nom text; v_qui text;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  select * into ci from catalogue_items where id = p_item and fusionne_vers_id is null;
  if not found then raise exception 'article_introuvable'; end if;
  v_nom := nullif(regexp_replace(trim(coalesce(p_nom, '')), '\s+', ' ', 'g'), '');
  if p_type is not null and p_type not in ('consommable','equipement','stock','petit_equipement') then raise exception 'type_invalide'; end if;
  select coalesce(s.email, a.prenom, 'bureau') into v_qui from (select auth.uid() u) x
    left join staff_users s on s.auth_user_id = x.u left join auto_entrepreneur a on a.ae_user_id = x.u limit 1;
  begin
    update catalogue_items set nom = coalesce(v_nom, nom), categorie = coalesce(nullif(trim(p_categorie), ''), categorie),
           type = coalesce(p_type, type), a_verifier = false, verifie_le = now(), verifie_par = v_qui
     where id = p_item returning * into ci;
  exception when unique_violation then raise exception 'nom_existe';
  end;
  return to_jsonb(ci);
end $$;

-- ── Bureau : fusionner un doublon dans le bon article ─────────────────────
-- Les références rebasculent vers l'article gardé. Une référence en conflit (le même logement / relevé a déjà
-- l'article gardé) reste sur l'article fusionné, désactivée pour la liste du logement : rien n'est supprimé.
create or replace function public.catalogue_fusionner(p_source uuid, p_cible uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s catalogue_items; c catalogue_items; n_cfg int := 0; n_cfg_conf int := 0; n_stk int := 0; n_lig int := 0; n_sac int := 0; n_mvt int := 0; n_dep int := 0; n_aut int := 0; v_qui text; r record;
begin
  if not auth_user_is_bureau() then raise exception 'acces_refuse'; end if;
  if p_source = p_cible then raise exception 'fusion_identique'; end if;
  select * into s from catalogue_items where id = p_source for update;
  select * into c from catalogue_items where id = p_cible for update;
  if s.id is null or c.id is null then raise exception 'article_introuvable'; end if;
  if s.fusionne_vers_id is not null or c.fusionne_vers_id is not null then raise exception 'article_deja_fusionne'; end if;

  -- Liste des logements
  for r in select * from inventaire_bien_config where item_id = s.id loop
    if exists (select 1 from inventaire_bien_config where bien_id = r.bien_id and item_id = c.id) then
      update inventaire_bien_config k set actif = k.actif or r.actif,
             piece_id = coalesce(k.piece_id, r.piece_id),
             quantite_attendue = coalesce(k.quantite_attendue, r.quantite_attendue),
             quantite_minimum = coalesce(k.quantite_minimum, r.quantite_minimum)
       where k.bien_id = r.bien_id and k.item_id = c.id;
      update inventaire_bien_config set actif = false where id = r.id;
      n_cfg_conf := n_cfg_conf + 1;
    else
      update inventaire_bien_config set item_id = c.id where id = r.id;
      n_cfg := n_cfg + 1;
    end if;
  end loop;
  -- État suivi par logement
  update inventaire_bien_stock t set item_id = c.id where t.item_id = s.id
     and not exists (select 1 from inventaire_bien_stock x where x.bien_id = t.bien_id and x.item_id = c.id);
  get diagnostics n_stk = row_count;
  -- Relevés d'inventaire
  update inventaire_releve_ligne t set item_id = c.id where t.item_id = s.id
     and not exists (select 1 from inventaire_releve_ligne x where x.releve_id = t.releve_id and x.item_id = c.id);
  get diagnostics n_lig = row_count;
  -- Sacs, historique, liens
  update besoin_sac set item_id = c.id where item_id = s.id; get diagnostics n_sac = row_count;
  update inventaire_mouvements set item_id = c.id where item_id = s.id; get diagnostics n_mvt = row_count;
  update catalogue_dependances d set equipement_id = c.id where d.equipement_id = s.id
     and not exists (select 1 from catalogue_dependances x where x.equipement_id = c.id and x.consommable_id = d.consommable_id);
  get diagnostics n_dep = row_count;
  update catalogue_dependances d set consommable_id = c.id where d.consommable_id = s.id
     and not exists (select 1 from catalogue_dependances x where x.consommable_id = c.id and x.equipement_id = d.equipement_id);
  get diagnostics n_aut = row_count; n_dep := n_dep + n_aut;
  update stock_article set catalogue_item_id = c.id where catalogue_item_id = s.id; get diagnostics n_aut = row_count;
  update direct_service set catalogue_item_id = c.id where catalogue_item_id = s.id;

  select coalesce(su.email, a.prenom, 'bureau') into v_qui from (select auth.uid() u) x
    left join staff_users su on su.auth_user_id = x.u left join auto_entrepreneur a on a.ae_user_id = x.u limit 1;
  update catalogue_items set fusionne_vers_id = c.id, fusionne_le = now(), a_verifier = false, verifie_le = now(), verifie_par = v_qui where id = s.id;
  update catalogue_items set a_verifier = false, verifie_le = coalesce(verifie_le, now()), verifie_par = coalesce(verifie_par, v_qui) where id = c.id and a_verifier;
  return jsonb_build_object('source', s.nom, 'cible', c.nom, 'logements', n_cfg, 'logements_deja_equipes', n_cfg_conf,
                            'etats', n_stk, 'releves', n_lig, 'sacs', n_sac, 'historique', n_mvt, 'liens', n_dep, 'stock_bureau', n_aut);
end $$;

-- ── inventaire_noter : article trouvé par la recherche → ajouté à la liste du logement ────
drop function if exists public.inventaire_noter(uuid, uuid, text, integer, text, text);
create or replace function public.inventaire_noter(p_releve uuid, p_item uuid, p_etat text, p_quantite integer default null,
  p_note text default null, p_photo_url text default null, p_piece uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  r inventaire_releve; c inventaire_bien_config; ci catalogue_items; l inventaire_releve_ligne; s inventaire_bien_stock;
  v_photo text; v_qte int; v_statut text; v_attendue int;
begin
  r := _inventaire_releve_check(p_releve);
  if p_etat not in ('present','manquant','abime') then raise exception 'etat_invalide'; end if;
  select * into c from inventaire_bien_config where bien_id = r.bien_id and item_id = p_item and actif;
  if not found then
    -- 563 : article choisi dans la recherche (ou créé sur place) → rejoint la liste du logement, dans la pièce où il est vu
    if p_piece is null then raise exception 'article_hors_inventaire'; end if;
    if not exists (select 1 from inventaire_piece where id = p_piece and bien_id = r.bien_id and actif) then raise exception 'piece_introuvable'; end if;
    select * into ci from catalogue_items where id = p_item;
    if ci.id is null or ci.type not in ('equipement','petit_equipement') then raise exception 'article_hors_inventaire'; end if;
    if ci.fusionne_vers_id is not null then
      p_item := ci.fusionne_vers_id;
      select * into c from inventaire_bien_config where bien_id = r.bien_id and item_id = p_item and actif;
    end if;
    if c.id is null then
      insert into inventaire_bien_config (bien_id, item_id, actif, added_by, piece_id)
      values (r.bien_id, p_item, true, 'inventaire_ae', p_piece)
      on conflict (bien_id, item_id) do update set actif = true, piece_id = coalesce(excluded.piece_id, inventaire_bien_config.piece_id)
      returning * into c;
    end if;
  end if;
  select * into ci from catalogue_items where id = p_item;
  select * into l from inventaire_releve_ligne where releve_id = r.id and item_id = p_item;
  v_photo := coalesce(nullif(trim(p_photo_url), ''), l.photo_url);
  -- 518 : photo obligatoire pour un article abîmé seulement (manquant : photo facultative)
  if p_etat = 'abime' and v_photo is null then raise exception 'photo_obligatoire'; end if;
  v_qte := case when p_etat = 'manquant' and p_quantite is null then 0 else p_quantite end;
  if v_qte is not null and (v_qte < 0 or v_qte > 999) then raise exception 'quantite_invalide'; end if;
  v_attendue := c.quantite_attendue;
  if v_attendue is null and v_qte is not null and p_etat = 'present' then
    v_attendue := v_qte;
    update inventaire_bien_config set quantite_attendue = v_qte where id = c.id;
  end if;
  insert into inventaire_releve_ligne (releve_id, item_id, piece_id, etat, quantite_attendue, quantite_constatee, etat_note, photo_url, vu_at)
  values (r.id, p_item, c.piece_id, p_etat, v_attendue, v_qte, nullif(left(trim(coalesce(p_note, '')), 300), ''), v_photo, now())
  on conflict (releve_id, item_id) do update set piece_id = excluded.piece_id, etat = excluded.etat, quantite_attendue = excluded.quantite_attendue,
     quantite_constatee = excluded.quantite_constatee, etat_note = excluded.etat_note, photo_url = excluded.photo_url, vu_at = now();
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
  return jsonb_build_object('etat', p_etat, 'statut_suivi', v_statut, 'quantite_attendue', v_attendue, 'quantite_constatee', v_qte, 'item_id', p_item);
end $function$;

revoke all on function public.catalogue_proches(text, int) from public, anon;
revoke all on function public.catalogue_article_creer(text, text, boolean) from public, anon;
revoke all on function public.catalogue_article_valider(uuid, text, text, text) from public, anon;
revoke all on function public.catalogue_fusionner(uuid, uuid) from public, anon;
revoke all on function public.inventaire_noter(uuid, uuid, text, integer, text, text, uuid) from public, anon;
grant execute on function public.catalogue_proches(text, int) to authenticated, service_role;
grant execute on function public.catalogue_article_creer(text, text, boolean) to authenticated, service_role;
grant execute on function public.catalogue_article_valider(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.catalogue_fusionner(uuid, uuid) to authenticated, service_role;
grant execute on function public.inventaire_noter(uuid, uuid, text, integer, text, text, uuid) to authenticated, service_role;

-- ── 5. Catalogue complété (sans doublon : insertion seulement si la clé n'existe pas) ──
insert into public.catalogue_items (nom, type, categorie, unite, agence)
select v.nom, v.type, v.categorie, 'unité', 'DCB'
  from (values
    -- Cuisine : cuisson et ustensiles
    ('Poêle moyenne', 'petit_equipement', 'Ustensiles'),
    ('Marmite', 'petit_equipement', 'Ustensiles'),
    ('Couvercles de casserole', 'petit_equipement', 'Ustensiles'),
    ('Sauteuse', 'petit_equipement', 'Ustensiles'),
    ('Wok', 'petit_equipement', 'Ustensiles'),
    ('Cocotte en fonte', 'petit_equipement', 'Ustensiles'),
    ('Plaque de four', 'petit_equipement', 'Ustensiles'),
    ('Roulette à pizza', 'petit_equipement', 'Ustensiles'),
    ('Rouleau à pâtisserie', 'petit_equipement', 'Ustensiles'),
    ('Verre doseur', 'petit_equipement', 'Ustensiles'),
    ('Cuillère en bois', 'petit_equipement', 'Ustensiles'),
    ('Pince de cuisine', 'petit_equipement', 'Ustensiles'),
    ('Décapsuleur', 'petit_equipement', 'Ustensiles'),
    ('Moulin à poivre', 'petit_equipement', 'Ustensiles'),
    ('Salière', 'petit_equipement', 'Ustensiles'),
    ('Boîtes de conservation', 'petit_equipement', 'Ustensiles'),
    -- Vaisselle et couverts
    ('Coupes à dessert', 'petit_equipement', 'Vaisselle'),
    ('Coquetiers', 'petit_equipement', 'Vaisselle'),
    ('Cuillères à dessert', 'petit_equipement', 'Couverts'),
    ('Fourchettes à dessert', 'petit_equipement', 'Couverts'),
    ('Couverts de service', 'petit_equipement', 'Couverts'),
    -- Petit électroménager
    ('Cafetière italienne', 'petit_equipement', 'Électroménager'),
    ('Batteur électrique', 'petit_equipement', 'Électroménager'),
    ('Appareil à raclette', 'petit_equipement', 'Électroménager'),
    -- Gros électroménager
    ('Plaque de cuisson', 'equipement', 'Électroménager'),
    ('Hotte aspirante', 'equipement', 'Électroménager'),
    -- Entretien (part dans le sac s'il manque)
    ('Balai', 'petit_equipement', 'Entretien'),
    ('Pelle et balayette', 'petit_equipement', 'Entretien'),
    ('Seau', 'petit_equipement', 'Entretien'),
    ('Serpillière', 'petit_equipement', 'Entretien'),
    ('Raclette de douche', 'petit_equipement', 'Entretien'),
    ('Panier à linge', 'petit_equipement', 'Entretien'),
    ('Pinces à linge', 'petit_equipement', 'Entretien'),
    ('Escabeau', 'equipement', 'Entretien'),
    ('Rideau de douche', 'petit_equipement', 'Salle de bain'),
    -- Décoration
    ('Miroir', 'equipement', 'Décoration'),
    ('Tableau', 'equipement', 'Décoration'),
    ('Cadre', 'equipement', 'Décoration'),
    ('Objet décoratif', 'equipement', 'Décoration'),
    ('Vase', 'equipement', 'Décoration'),
    ('Bougeoir', 'equipement', 'Décoration'),
    ('Plante artificielle', 'equipement', 'Décoration'),
    ('Tapis', 'equipement', 'Décoration'),
    -- Mobilier
    ('Table', 'equipement', 'Mobilier'),
    ('Chaises', 'equipement', 'Mobilier'),
    ('Tabourets', 'equipement', 'Mobilier'),
    ('Canapé', 'equipement', 'Mobilier'),
    ('Fauteuil', 'equipement', 'Mobilier'),
    ('Table basse', 'equipement', 'Mobilier'),
    ('Table de chevet', 'equipement', 'Mobilier'),
    ('Commode', 'equipement', 'Mobilier'),
    ('Armoire / penderie', 'equipement', 'Mobilier'),
    ('Bureau (meuble)', 'equipement', 'Mobilier'),
    ('Étagère', 'equipement', 'Mobilier'),
    ('Lampe de chevet', 'equipement', 'Mobilier'),
    ('Lampadaire', 'equipement', 'Mobilier'),
    -- Confort, sécurité, extérieur
    ('Rideaux', 'equipement', 'Confort'),
    ('Radiateur d''appoint', 'equipement', 'Confort'),
    ('Box internet', 'equipement', 'Confort'),
    ('Télécommande', 'equipement', 'Confort'),
    ('Multiprise', 'equipement', 'Confort'),
    ('Couverture anti-feu', 'equipement', 'Sécurité'),
    ('Lampe torche', 'equipement', 'Sécurité'),
    ('Tuyau d''arrosage', 'equipement', 'Extérieur'),
    ('Ustensiles de barbecue', 'equipement', 'Extérieur'),
    ('Coussins d''extérieur', 'equipement', 'Extérieur')
  ) as v(nom, type, categorie)
 where not exists (select 1 from public.catalogue_items ci where ci.agence = 'DCB' and ci.cle_nom = public.catalogue_cle_nom(v.nom) and ci.fusionne_vers_id is null);

-- ── 563e : proches = aussi un mot significatif en commun (« Poêle à crêpes » → les poêles) ──
create or replace function public.catalogue_proches(p_nom text, p_limite int default 6)
returns table (id uuid, nom text, type text, categorie text, score real, identique boolean)
language sql stable security definer set search_path = public, extensions as $$
  with k as (select public.catalogue_cle_nom(p_nom) as cle)
  select ci.id, ci.nom, ci.type, ci.categorie,
         (greatest(similarity(ci.cle_nom, k.cle), word_similarity(k.cle, ci.cle_nom), word_similarity(ci.cle_nom, k.cle))
          + case when exists (select 1 from unnest(string_to_array(k.cle, ' ')) w where length(w) >= 4 and w = any(string_to_array(ci.cle_nom, ' '))) then 0.2 else 0 end)::real as score,
         ci.cle_nom = k.cle as identique
    from catalogue_items ci, k
   where auth_user_is_internal() and ci.fusionne_vers_id is null and ci.agence = 'DCB' and k.cle <> ''
     and (ci.cle_nom = k.cle
          or similarity(ci.cle_nom, k.cle) >= 0.45
          or word_similarity(k.cle, ci.cle_nom) >= 0.6
          or word_similarity(ci.cle_nom, k.cle) >= 0.6
          or exists (select 1 from unnest(string_to_array(k.cle, ' ')) w where length(w) >= 4 and w = any(string_to_array(ci.cle_nom, ' '))))
   order by (ci.cle_nom = k.cle) desc, 5 desc, ci.nom
   limit greatest(1, least(coalesce(p_limite, 6), 20))
$$;

-- ── 563f : la liste du logement accepte added_by = 'inventaire_ae' ──
alter table public.inventaire_bien_config drop constraint inventaire_bien_config_added_by_check;
alter table public.inventaire_bien_config add constraint inventaire_bien_config_added_by_check
  check (added_by = any (array['manuel','auto_dependance','init','migration','hospitable','inventaire_ae']));
comment on constraint inventaire_bien_config_added_by_check on public.inventaire_bien_config is
  '563 : inventaire_ae = article trouvé par la recherche (ou créé) pendant un inventaire terrain et ajouté à la liste du logement';
