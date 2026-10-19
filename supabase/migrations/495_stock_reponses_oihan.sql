-- 495 — 📦 Stock : réponses d'Oïhan du 19/10/2026 (suite de 491/491b)
--  1. « MM » = garage de la Maison Maïté = TRANSIT des sacs, aucun stock → pas de dépôt. Cave ML = transit des sacs
--     + MINI STOCK (liste courte). Dépôt principal = MFC (tout le stock, préparation des sacs). Les sorties « sac fait »
--     sortent du MFC, sauf si la zone de préparation indique explicitement la Cave ML (stock_depot_sortie). Le passage
--     d'un sac par MM ou la Cave ML ne crée AUCUN mouvement.
--  2. Microfibres, serpillères, gratte : lavées et réutilisées → circulant.
--  3. « Draps Single » 2023 = Twin.
--  4. « poche savon » = 1 gros distributeur de savon + 1 fiole de savon + 1 fiole de liquide vaisselle (composition
--     d'un libellé en plusieurs articles) ; « Dosettes » = capsules Nespresso.
--  5. Coûts : cout_fiabilite facture | document | estime + source + date (document d'achat linge du 03/03/2025 ; prix
--     publics internet relevés le 19/10/2026) ; sans coût fiable = null.
--  6. Blanchisserie Garbitoki : emplacement circulant du LINGE PLAT (famille linge_lit) ; serviettes, tapis, torchons,
--     microfibres restent « Au sale » (lavés en interne).
--  7. Sacs poubelle : 20 par rouleau.
--  8. Laura et Léa (droit « stock ») peuvent saisir pertes, casse, jeté et transferts (pas les coûts, pas la validation).
--  9. Lit bébé / chaise haute : source unique = equipment (📦 Équipements), quantités affichées dans le stock en lecture,
--     jamais comptées ni mouvementées dans le stock.

-- ─────────────────────────────────────────────────────────────── dépôts
alter table public.stock_depot drop constraint if exists stock_depot_role_check;
alter table public.stock_depot add constraint stock_depot_role_check check (role in ('stock', 'logements', 'sale', 'blanchisserie'));
alter table public.stock_depot add column if not exists par_defaut boolean not null default false;
alter table public.stock_depot add column if not exists liste_courte boolean not null default false;
alter table public.stock_depot add column if not exists transit_sacs boolean not null default false;
comment on column public.stock_depot.par_defaut is 'Dépôt d''où sortent les sacs quand la zone de préparation ne désigne pas explicitement un autre dépôt (MFC). Migration 495.';
comment on column public.stock_depot.liste_courte is 'Mini stock : seuls les articles de stock_depot_article y sont suivis et comptés (Cave ML). Migration 495.';
comment on column public.stock_depot.transit_sacs is 'Les sacs y transitent (aucun mouvement de stock pour ce passage). Migration 495.';

create table if not exists public.stock_depot_article (
  depot_id uuid not null references public.stock_depot(id) on delete cascade,
  article_id uuid not null references public.stock_article(id) on delete cascade,
  primary key (depot_id, article_id)
);
alter table public.stock_depot_article enable row level security;
revoke all on public.stock_depot_article from anon, authenticated;

update public.stock_depot set par_defaut = true, note = 'Dépôt principal : tout le stock, préparation des sacs (bien 01). Les sacs « sac fait » sortent d''ici sauf indication explicite « Cave ML ».'
 where code = 'MFC';
update public.stock_depot set liste_courte = true, transit_sacs = true, codes_zone_sac = array['Cave ML', 'Cave', 'ML', 'Mont Louis', 'Mont-Louis'],
       note = 'Cave de Mont-Louis : point de transit des sacs + mini stock (petit équipement d''urgence, quelques produits). Liste courte à valider par Oïhan.'
 where code = 'CAVE-ML';
insert into public.stock_depot (code, nom, type, role, zone, codes_zone_sac, ordre, note) values
  ('GARBITOKI', 'Blanchisserie Garbitoki', 'virtuel', 'blanchisserie', 'cote_basque', '{}', 85,
   'Linge plat (draps, housses, taies) en cours de nettoyage chez Garbitoki. Serviettes, tapis, torchons et microfibres sont lavés en interne (« Au sale »).')
on conflict (code) do nothing;
update public.stock_depot set note = 'Linge sale en attente de lavage INTERNE (serviettes, tapis, torchons, microfibres, serpillères) et linge plat pas encore parti chez Garbitoki.'
 where code = 'SALE';

-- Dépôt de sortie d'un sac selon la zone de préparation (tache_sac.zone_sac) : zone listée dans codes_zone_sac
-- (comparaison sans casse ni accents) sinon dépôt par défaut (MFC). « MM » (garage Maison Maïté) = transit → MFC.
create or replace function public.stock_depot_sortie(p_zone text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select d.id from stock_depot d, unnest(d.codes_zone_sac) z
      where d.actif and d.role = 'stock' and p_zone is not null
        and lower(extensions.unaccent(trim(z))) = lower(extensions.unaccent(trim(p_zone))) limit 1),
    (select d.id from stock_depot d where d.par_defaut and d.actif order by d.ordre limit 1));
$$;

-- ─────────────────────────────────────────────────────────────── articles : coûts, équipements, compositions
alter table public.stock_article add column if not exists cout_fiabilite text check (cout_fiabilite in ('facture', 'document', 'estime'));
alter table public.stock_article add column if not exists cout_source text;
alter table public.stock_article add column if not exists cout_date date;
alter table public.stock_article add column if not exists equipement_motif text;
comment on column public.stock_article.equipement_motif is 'Article suivi par 📦 Équipements (table equipment, source unique) : motif ILIKE sur equipment.nom ; quantité affichée en lecture, jamais comptée ni mouvementée ici. Migration 495.';

insert into public.stock_article (code, nom, famille, nature, unite, ordre, source, note) values
  ('DISTRIB-SAVON', 'Gros distributeur de savon', 'accueil', 'consomme', 'pièce', 74, 'etiquettes', 'Étiquettes : « poche savon » = distributeur + fiole de savon + fiole de liquide vaisselle'),
  ('FIOLE-SAVON', 'Fiole de savon', 'accueil', 'consomme', 'pièce', 74, 'etiquettes', 'Étiquettes : « poche savon »'),
  ('FIOLE-VAISSELLE', 'Fiole de liquide vaisselle', 'accueil', 'consomme', 'pièce', 74, 'etiquettes', 'Étiquettes : « poche savon »')
on conflict (code) do nothing;

update public.stock_article set note = 'Ancien inventaire : « Draps Single » = Twin (confirmé par Oïhan)' where code = 'DRAP-TWIN';
update public.stock_article set nature = 'circulant', note = 'Lavée et réutilisée (Oïhan)' where code = 'GRATTE';
update public.stock_article set note = 'Lavée et réutilisée (Oïhan)' where code in ('MICROFIBRE-MENAGE', 'MICROFIBRE-GRISE', 'MICROFIBRE-NOIRE', 'SERPILLERE-ESP', 'SERPILLERE-VILEDA', 'SERPILLERE-SCRATCH');
update public.stock_article set conditionnement = 'rouleau', conditionnement_qte = 20, note = null where code in ('SAC-10L', 'SAC-20L', 'SAC-50L', 'SAC-100L');
update public.stock_article set equipement_motif = 'Lit bébé%', note = 'Quantités : 📦 Équipements (source unique), affichées ici en lecture' where code = 'LIT-BEBE';
update public.stock_article set equipement_motif = 'Chaise haute%', note = 'Quantités : 📦 Équipements (source unique), affichées ici en lecture' where code = 'CHAISE-HAUTE';

-- Coûts HT (centimes). Document : tableau d'achat du linge « linge.pdf » (iCloud › 06 OUTILS & PROCESS › Linge et
-- inventaire, 03/03/2025, gammes Denver / Boston / Greca) — coût de nettoyage par article TTC gardé dans repere.
update public.stock_article a set cout_defaut_centimes = v.c, cout_fiabilite = v.f, cout_source = v.s, cout_date = v.d::date,
       repere = a.repere || coalesce(v.r, '{}'::jsonb)
  from (values
   ('DRAP-KING', 3150, 'document', 'Tableau d''achat linge (linge.pdf) : drap plat 280 × 300 Denver, 31,50 € HT', '2025-03-03', '{"nettoyage_ttc": 3.72}'::jsonb),
   ('DRAP-TWIN', 2100, 'document', 'Tableau d''achat linge (linge.pdf) : drap plat 190 × 300 Denver, 21,00 € HT', '2025-03-03', '{"nettoyage_ttc": 3.72}'::jsonb),
   ('HOUSSE-KING', 4813, 'document', 'Tableau d''achat linge (linge.pdf) : housse de couette 270 × 280 Boston, 48,13 € HT', '2025-03-03', '{"nettoyage_ttc": 7.20}'::jsonb),
   ('HOUSSE-TWIN', 3413, 'document', 'Tableau d''achat linge (linge.pdf) : housse de couette 130 × 280 Boston, 34,13 € HT', '2025-03-03', '{"nettoyage_ttc": 7.20}'::jsonb),
   ('TAIE-CARREE', 726, 'document', 'Tableau d''achat linge (linge.pdf) : taie 67 × 69 Denver, 7,26 € HT', '2025-03-03', '{"nettoyage_ttc": 1.32}'::jsonb),
   ('TAIE-RECT', 726, 'document', 'Tableau d''achat linge (linge.pdf) : taie rectangle Denver, 7,26 € HT', '2025-03-03', '{"nettoyage_ttc": 1.32}'::jsonb),
   ('GRANDE-SERV', 704, 'document', 'Tableau d''achat linge (linge.pdf) : drap de bain 70 × 150 Greca, 7,04 € HT', '2025-03-03', '{"nettoyage_ttc": 2.26}'::jsonb),
   ('PETITE-SERV', 354, 'document', 'Tableau d''achat linge (linge.pdf) : serviette 50 × 100 Greca, 3,54 € HT', '2025-03-03', '{"nettoyage_ttc": 1.70}'::jsonb),
   ('CARRE-VISAGE', 72, 'document', 'Tableau d''achat linge (linge.pdf) : carré visage 30 × 30, 0,72 € HT', '2025-03-03', '{"nettoyage_ttc": 1.20}'::jsonb),
   ('TAPIS-BAIN', 438, 'document', 'Tableau d''achat linge (linge.pdf) : tapis de bain Greca 50 × 65, 4,38 € HT', '2025-03-03', '{"nettoyage_ttc": 2.09}'::jsonb),
   ('DRAP-QUEEN', 2625, 'estime', 'Estimé : milieu entre drap King (31,50) et Twin (21,00) de la même gamme (linge.pdf)', '2025-03-03', null),
   ('HOUSSE-QUEEN', 4113, 'estime', 'Estimé : milieu entre housse King (48,13) et Twin (34,13) de la même gamme (linge.pdf)', '2025-03-03', null),
   ('CAPS-NESPRESSO', 25, 'estime', 'Prix public : capsules compatibles pro 0,26 à 0,35 € TTC (maxicoffee.com), ≈ 0,25 € HT', '2026-10-19', null),
   ('DOSETTE-SENSEO', 11, 'estime', 'Prix public : paquet de 36 dosettes 4,50 à 5,50 € TTC (graindexpert.fr 2026), ≈ 0,11 € HT', '2026-10-19', null),
   ('SAC-50L', 25, 'estime', 'Prix public : rouleau de 20 sacs 50 L à 5,99 € TTC (castorama.fr), ≈ 0,25 € HT le sac', '2026-10-19', null),
   ('MICROFIBRE-MENAGE', 160, 'estime', 'Prix public : lot de 10 lavettes microfibre 40 × 40 à 18,84 € TTC (Spontex), ≈ 1,60 € HT ; pro 3,37 € HT (RS)', '2026-10-19', null),
   ('MICROFIBRE-GRISE', 160, 'estime', 'Comme la microfibre de ménage (≈ 1,60 € HT)', '2026-10-19', null),
   ('MICROFIBRE-NOIRE', 160, 'estime', 'Comme la microfibre de ménage (≈ 1,60 € HT)', '2026-10-19', null),
   ('SERPILLERE-ESP', 390, 'estime', 'Prix public pro : frange coton 40 cm 3,90 € HT (voussert.fr)', '2026-10-19', null)
  ) as v(code, c, f, s, d, r)
 where a.code = v.code;

-- ─────────────────────────────────────────────────────────────── libellés composés
alter table public.stock_libelle_article add column if not exists composition jsonb;
comment on column public.stock_libelle_article.composition is 'Libellé qui désigne plusieurs articles : [{"article_id", "quantite"}] par unité du libellé (ex. « poche savon » = 3 articles). Migration 495.';
update public.stock_libelle_article set statut = 'relie', article_id = null, maj_le = now(),
  composition = jsonb_build_array(
    jsonb_build_object('article_id', (select id from public.stock_article where code = 'DISTRIB-SAVON'), 'quantite', 1),
    jsonb_build_object('article_id', (select id from public.stock_article where code = 'FIOLE-SAVON'), 'quantite', 1),
    jsonb_build_object('article_id', (select id from public.stock_article where code = 'FIOLE-VAISSELLE'), 'quantite', 1))
 where libelle = 'poche savon';
update public.stock_libelle_article set statut = 'relie', article_id = (select id from public.stock_article where code = 'CAPS-NESPRESSO'), composition = null, maj_le = now()
 where libelle = 'dosette';

create or replace function public.stock_nomenclature_recalculer(p_sac uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from stock_nomenclature_sac where p_sac is null or sac_id = p_sac;
  with l as (
    select s.id sac_id, s.bien_id, bb.b0->>'titre' bloc, x.v ligne, null::int pax_min, (bo * 100 + lo)::int o
      from bien_sac_preparation s
      cross join lateral jsonb_array_elements(coalesce(s.blocs, '[]')) with ordinality as bb(b0, bo)
      cross join lateral jsonb_array_elements_text(coalesce(bb.b0->'lignes', '[]')) with ordinality as x(v, lo)
     where s.actif and (p_sac is null or s.id = p_sac)
    union all
    select s.id, s.bien_id, r.r0->>'texte', x.v, nullif(r.r0->>'pax_min', '')::int, (10000 + ro * 100 + lo)::int
      from bien_sac_preparation s
      cross join lateral jsonb_array_elements(coalesce(s.regles_pax, '[]')) with ordinality as r(r0, ro)
      cross join lateral jsonb_array_elements_text(coalesce(r.r0->'lignes', '[]')) with ordinality as x(v, lo)
     where s.actif and (p_sac is null or s.id = p_sac)
  ), seg as (
    select l.*, d.ordre so, d.segment, d.quantite, d.libelle from l cross join lateral stock_decouper_ligne(l.ligne) d where d.libelle <> ''
  ), nouv as (
    insert into stock_libelle_article (libelle, exemple, occurrences)
    select libelle, min(segment), count(*) from seg group by libelle
    on conflict (libelle) do nothing
    returning 1
  ), ins as (
    insert into stock_nomenclature_sac (sac_id, bien_id, bloc, ligne, segment, libelle, quantite, pax_min, article_id, ordre)
    select seg.sac_id, seg.bien_id, seg.bloc, seg.ligne, seg.segment, seg.libelle,
           seg.quantite * coalesce((c.x->>'quantite')::numeric, 1), seg.pax_min,
           case when la.composition is not null then (c.x->>'article_id')::uuid when la.statut = 'relie' then la.article_id end,
           (seg.o * 10 + seg.so) * 10 + coalesce(c.i, 0)::int
      from seg
      left join stock_libelle_article la on la.libelle = seg.libelle
      left join lateral jsonb_array_elements(case when la.statut = 'relie' then la.composition end) with ordinality as c(x, i) on true
    returning 1
  )
  select count(*) into v_n from ins;
  update stock_libelle_article la set occurrences = coalesce((select count(distinct (n.sac_id, n.ordre / 10)) from stock_nomenclature_sac n where n.libelle = la.libelle), 0);
  return v_n;
end $$;
revoke all on function public.stock_nomenclature_recalculer(uuid) from public, anon, authenticated;

create or replace function public.stock_libelle_relier(p_libelle text, p_article uuid, p_statut text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_statut text := coalesce(p_statut, case when p_article is null then 'a_relier' else 'relie' end);
begin
  perform stock_exiger('admin');
  if v_statut not in ('relie', 'a_relier', 'ignore') then raise exception 'statut_invalide'; end if;
  update stock_libelle_article set article_id = case when v_statut = 'relie' then p_article end, composition = null, statut = v_statut, maj_le = now(), maj_par = auth.uid()
   where libelle = p_libelle;
  return stock_nomenclature_recalculer(null);
end $$;

-- ─────────────────────────────────────────────────────────────── saisies : niveau comptage autorisé pour pertes / transferts
create or replace function public.stock_mouvement_saisir(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_niv text := stock_exiger('comptage'); v_type text := p->>'type'; v_q numeric := (p->>'quantite')::numeric; v_op uuid := gen_random_uuid();
  v_art uuid := (p->>'article_id')::uuid; v_dep uuid := (p->>'depot_id')::uuid; v_vers uuid := nullif(p->>'vers_depot_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'date', '')::date, current_date); v_cle text := nullif(p->>'cle', ''); v1 uuid; v2 uuid;
begin
  if v_niv <> 'admin' and v_type not in ('transfert', 'perte', 'casse', 'jete') then raise exception 'acces_refuse'; end if;
  if v_art is null or v_dep is null or coalesce(v_q, 0) = 0 then raise exception 'saisie_incomplete'; end if;
  if (select equipement_motif from stock_article where id = v_art) is not null then raise exception 'article_suivi_par_equipements'; end if;
  if v_type = 'transfert' then
    if v_vers is null or v_vers = v_dep then raise exception 'transfert_sans_destination'; end if;
    v1 := stock_mouvement_inserer(v_art, v_dep, -abs(v_q), 'transfert', case when v_cle is not null then v_cle || ':depart' end, null, v_op, v_date, p->>'note');
    if v1 is null then return jsonb_build_object('ok', true, 'doublon', true); end if;
    v2 := stock_mouvement_inserer(v_art, v_vers, abs(v_q), 'transfert', case when v_cle is not null then v_cle || ':arrivee' end,
      (select cout_unitaire_centimes from stock_mouvement where id = v1), v_op, v_date, p->>'note');
  elsif v_type = 'ajustement' then
    v1 := stock_mouvement_inserer(v_art, v_dep, v_q, 'ajustement', v_cle, null, v_op, v_date, p->>'note');
  elsif v_type in ('perte', 'casse', 'jete', 'don', 'dotation_ae', 'usage_bureau', 'sortie_sac', 'sortie_recouche', 'sortie_besoin_sac') then
    v1 := stock_mouvement_inserer(v_art, v_dep, -abs(v_q), v_type, v_cle, null, v_op, v_date, p->>'note',
      coalesce(nullif(p->>'agence', ''), 'dcb'), nullif(p->>'bien_id', '')::uuid, null, nullif(p->>'ae_id', '')::uuid);
  else
    raise exception 'type_non_saisissable';
  end if;
  return jsonb_build_object('ok', true, 'operation_id', v_op, 'doublon', v1 is null);
end $$;

-- Article comptable à un emplacement : dépôt (liste courte éventuelle), logements / sale = circulant,
-- blanchisserie = linge plat (famille linge_lit) ; jamais les articles suivis par 📦 Équipements.
create or replace function public.stock_article_admis(p_article uuid, p_depot uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when a.equipement_motif is not null then 'article_suivi_par_equipements'
    when d.role = 'stock' and d.liste_courte and not exists (select 1 from stock_depot_article x where x.depot_id = d.id and x.article_id = a.id) then 'hors_liste_courte'
    when d.role in ('logements', 'sale') and a.nature <> 'circulant' then 'emplacement_reserve_au_linge'
    when d.role = 'blanchisserie' and (a.nature <> 'circulant' or a.famille <> 'linge_lit') then 'blanchisserie_linge_plat'
    end
  from stock_article a, stock_depot d where a.id = p_article and d.id = p_depot;
$$;

create or replace function public.stock_comptage_saisir(p_id uuid, p_article uuid, p_depot uuid, p_quantite numeric,
  p_ajout boolean default false, p_proposee numeric default null, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare c stock_comptage; v numeric; v_refus text;
begin
  perform stock_exiger('comptage');
  select * into c from stock_comptage where id = p_id;
  if c.statut <> 'en_cours' then raise exception 'comptage_ferme'; end if;
  if not (p_depot = any (c.depots)) then raise exception 'depot_hors_comptage'; end if;
  v_refus := stock_article_admis(p_article, p_depot);
  if v_refus is not null then raise exception '%', v_refus; end if;
  insert into stock_comptage_ligne as l (comptage_id, article_id, depot_id, quantite_comptee, quantite_proposee, compte_par, compte_le, note)
  values (p_id, p_article, p_depot, case when p_quantite is null then null else greatest(0, p_quantite) end, p_proposee, auth.uid(), now(), p_note)
  on conflict (comptage_id, article_id, depot_id) do update set
    quantite_comptee = case when p_quantite is null then null
                            when p_ajout then greatest(0, coalesce(l.quantite_comptee, 0) + p_quantite)
                            else greatest(0, p_quantite) end,
    quantite_proposee = coalesce(excluded.quantite_proposee, l.quantite_proposee),
    note = coalesce(excluded.note, l.note), compte_par = auth.uid(), compte_le = now()
  returning quantite_comptee into v;
  return v;
end $$;

create or replace function public.stock_depot_articles_definir(p_depot uuid, p_articles uuid[])
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform stock_exiger('admin');
  delete from stock_depot_article where depot_id = p_depot;
  insert into stock_depot_article (depot_id, article_id) select p_depot, x from unnest(coalesce(p_articles, '{}')) x on conflict do nothing;
  update stock_depot set liste_courte = (coalesce(array_length(p_articles, 1), 0) > 0) where id = p_depot and role = 'stock' and not par_defaut;
  return (select count(*) from stock_depot_article where depot_id = p_depot);
end $$;

-- Mini stock de la Cave ML proposé (à valider par Oïhan)
insert into public.stock_depot_article (depot_id, article_id)
select d.id, a.id from public.stock_depot d, public.stock_article a
 where d.code = 'CAVE-ML' and a.code in ('ASPIRATEUR', 'PQ', 'SAC-50L', 'SAC-100L', 'MICROFIBRE-MENAGE', 'EPONGE', 'VINAIGRE-BIDON', 'SAVON-NOIR-BIDON', 'PRODUIT-VITRE', 'LESSIVE-PACK')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────── lecture
create or replace function public.stock_etat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_niv text := stock_exiger('comptage'); adm boolean := (v_niv = 'admin');
begin
  return jsonb_build_object(
    'niveau', v_niv,
    'depots', (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('articles',
        (select coalesce(jsonb_agg(x.article_id), '[]') from stock_depot_article x where x.depot_id = d.id)) order by d.ordre, d.nom), '[]') from stock_depot d),
    'articles', (select coalesce(jsonb_agg(
        (to_jsonb(a) - case when adm then '{}'::text[] else array['cout_defaut_centimes', 'cmp_centimes', 'cout_source', 'cout_fiabilite', 'cout_date'] end)
        || jsonb_build_object('cout_centimes', case when adm then coalesce(a.cmp_centimes, a.cout_defaut_centimes) end,
             'equipements_qte', case when a.equipement_motif is not null then
               (select coalesce(sum(e.quantite), 0) from equipment e where e.actif and e.nom ilike a.equipement_motif) end)
        order by a.ordre, a.nom), '[]') from stock_article a),
    'soldes', (select coalesce(jsonb_agg(jsonb_build_object('article_id', s.article_id, 'depot_id', s.depot_id, 'quantite', s.quantite,
        'valeur_centimes', case when adm then s.valeur_centimes end)), '[]') from stock_solde s where s.quantite <> 0 or s.valeur_centimes <> 0),
    'seuils', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from stock_seuil x),
    'fournisseurs', case when adm then (select coalesce(jsonb_agg(to_jsonb(f) order by f.nom), '[]') from stock_fournisseur f) else '[]'::jsonb end,
    'libelles', (select coalesce(jsonb_agg(to_jsonb(l) order by l.statut, l.occurrences desc, l.libelle), '[]') from stock_libelle_article l),
    'comptage_en_cours', (select to_jsonb(c) from stock_comptage c where c.statut in ('en_cours', 'soumis') order by c.cree_le desc limit 1),
    'dernier_inventaire', (select jsonb_build_object('id', c.id, 'titre', c.titre, 'date', c.date_comptage, 'valide_le', c.valide_le)
                            from stock_comptage c where c.statut = 'valide' order by c.valide_le desc limit 1),
    'nb_mouvements', (select count(*) from stock_mouvement),
    'controle', (select jsonb_build_object('fait_le', fait_le, 'nb_ecarts', nb_ecarts) from stock_controle order by id desc limit 1)
  );
end $$;

-- Essai à blanc : + dépôt de sortie de chaque sac (règle stock_depot_sortie)
create or replace function public.stock_essai_sorties(p_du date default current_date - 30, p_au date default current_date - 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform stock_exiger('admin');
  with m as (
    select mm.id, mm.bien_id, mm.date_mission, mm.type_mission, mm.recouche_jeux, b.code, b.agence,
           coalesce(ms.sac_fait, false) sac_fait, ms.zone_sac, stock_depot_sortie(ms.zone_sac) depot_sortie,
           coalesce(case when mm.type_mission = 'recouche' then mm.vente_voyageurs::int end,
             (select r.guest_count from reservation r where r.bien_id = mm.bien_id and r.final_status = 'accepted'
                and case when mm.type_mission = 'recouche' then r.arrival_date <= mm.date_mission and r.departure_date > mm.date_mission
                         else r.arrival_date >= mm.date_mission end order by r.arrival_date limit 1)) voyageurs
      from mission_menage mm join bien b on b.id = mm.bien_id
      left join mission_sac ms on ms.mission_id = mm.id
     where mm.date_mission between p_du and p_au and mm.statut <> 'cancelled'
       and (mm.type_mission = 'checkout' or (mm.type_mission = 'recouche' and coalesce(mm.recouche_linge, true)))
  ), l as (
    select m.*, n.article_id, n.libelle, n.quantite
      from m join bien_sac_preparation s on s.bien_id = m.bien_id and s.actif
      join stock_nomenclature_sac n on n.sac_id = s.id
     where (n.pax_min is null or coalesce(m.voyageurs, 0) >= n.pax_min)
       and (m.type_mission = 'checkout' or n.bloc in ('Draps', 'Serviettes'))
  )
  select jsonb_build_object(
    'du', p_du, 'au', p_au,
    'missions', (select count(*) from m),
    'sac_fait', (select count(*) from m where sac_fait),
    'repli_a_verifier', (select count(*) from m where not sac_fait),
    'sans_etiquette', (select coalesce(jsonb_agg(distinct code), '[]') from m where not exists (select 1 from bien_sac_preparation s where s.bien_id = m.bien_id and s.actif)),
    'par_zone', (select coalesce(jsonb_object_agg(z, n), '{}') from (select coalesce(zone_sac, '(non renseignée)') z, count(*) n from m where sac_fait group by 1) t),
    'par_depot_sortie', (select coalesce(jsonb_object_agg(coalesce(d.nom, '?'), t.n), '{}') from (select depot_sortie, count(*) n from m where sac_fait group by 1) t left join stock_depot d on d.id = t.depot_sortie),
    'par_agence', (select coalesce(jsonb_object_agg(agence, n), '{}') from (select agence, count(*) n from m group by 1) t),
    'articles', (select coalesce(jsonb_agg(t order by t.nature, t.sac_fait desc nulls last, t.repli desc nulls last), '[]') from (
        select a.id article_id, a.code, a.nom, a.nature, a.unite,
               sum(l.quantite) filter (where l.sac_fait) sac_fait, sum(l.quantite) filter (where not l.sac_fait) repli,
               sum(l.quantite) filter (where l.agence = 'lauian') lauian,
               round(sum(l.quantite * coalesce(a.cmp_centimes, a.cout_defaut_centimes)) filter (where l.sac_fait)) valeur_centimes
          from l join stock_article a on a.id = l.article_id group by a.id) t),
    'a_relier', (select coalesce(jsonb_agg(t), '[]') from (select libelle, sum(quantite) quantite, count(distinct id) missions from l where article_id is null group by 1 order by 2 desc) t)
  ) into v;
  return v;
end $$;

do $$ declare f text; begin
  foreach f in array array['stock_depot_sortie(text)', 'stock_article_admis(uuid, uuid)', 'stock_depot_articles_definir(uuid, uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select public.stock_nomenclature_recalculer(null);

-- Coût saisi à la main dans Réglages → fiabilité « estime », source « saisi dans PowerHouse », date du jour
create or replace function public.stock_article_cout_trace()
returns trigger language plpgsql as $$
begin
  if new.cout_defaut_centimes is distinct from old.cout_defaut_centimes and new.cout_source is not distinct from old.cout_source then
    new.cout_fiabilite := case when new.cout_defaut_centimes is null then null else coalesce(nullif(current_setting('stock.cout_fiabilite', true), ''), 'estime') end;
    new.cout_source := case when new.cout_defaut_centimes is null then null else 'Saisi dans PowerHouse (Réglages du stock)' end;
    new.cout_date := case when new.cout_defaut_centimes is null then null else current_date end;
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_article_cout_trace on public.stock_article;
create trigger trg_stock_article_cout_trace before update of cout_defaut_centimes on public.stock_article
  for each row execute function public.stock_article_cout_trace();
