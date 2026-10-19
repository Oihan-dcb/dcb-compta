-- 491 — 📦 STOCK du bureau (19/10/2026, lots 0 + 1 du plan validé par Oïhan)
--
-- Réponses d'Oïhan (19/10/2026) :
--  · Dépôts : UNIQUEMENT « MFC » (le bureau, bien 01) et « Cave ML » (cave de Mont Louis) ; pas de stock à Bordeaux
--    pour l'instant, mais la notion de zone est gardée (stock_depot.zone).
--  · Lauïan pioche dans le stock DCB (DCB récupère le FMEN) : AUCUNE refacturation entre sociétés ; la valeur
--    consommée par agence reste visible (stock_mouvement.agence), sans facture.
--  · Inventaire du linge : stock propre au dépôt + linge EN PLACE dans les logements + linge AU SALE
--    → deux emplacements virtuels « Dans les logements » et « Au sale » ; le parc total = la somme.
--  · Sorties automatiques depuis « sac fait » : PRÉPARÉES (nomenclature des sacs + essai à blanc) mais PAS activées
--    dans ce lot (aucun déclencheur sur tache_sac ; stock_essai_sorties n'écrit rien).
--
-- Modèle :
--  stock_depot            dépôts physiques + emplacements virtuels (logements, sale)
--  stock_article          articles (famille, taille, nature consomme|circulant|equipement, unité, conditionnement,
--                         coût par défaut, CMP maintenu par le journal)
--  stock_seuil            seuil d'alerte / stock cible par article (et dépôt, null = dépôts physiques confondus)
--  stock_mouvement        JOURNAL IMMUABLE (ni UPDATE ni DELETE) ; cle_source unique = anti-doublon ;
--                         annulation = mouvement inverse (annule_mouvement_id, une seule fois) ;
--                         coût unitaire (CMP) FIGÉ dans chaque ligne, valeur = quantité × coût
--  stock_solde            solde par article × dépôt, tenu par déclencheur + contrôle nocturne (stock_controle)
--  stock_fournisseur, stock_reception (+ lignes)
--  stock_comptage (+ lignes)   inventaires guidés ; validation → mouvements « stock_initial » (1er inventaire)
--                              ou « ecart_comptage » chiffrés
--  stock_libelle_article  dictionnaire libellé d'étiquette (normalisé) → article ; non reconnu = « à relier »
--  stock_nomenclature_sac contenu des sacs (bien_sac_preparation) traduit en articles (préparation du lot 2)
--
-- Droits (ph_droit, 414) : « stock » = lecture + comptage, sans coûts ; « stock_admin » = tout (coûts, réglages,
-- mouvements, réceptions, validation des inventaires). Oïhan : stock_admin ; Laura et Léa : stock.
-- Tout passe par des RPC security definer qui vérifient le droit ; les tables ne sont pas lisibles directement.

-- ─────────────────────────────────────────────────────────────── droits
alter table public.ph_droit drop constraint if exists ph_droit_droit_check;
alter table public.ph_droit add constraint ph_droit_droit_check
  check (droit = any (array['perf', 'honoraires', 'admin', 'rembourser', 'stock', 'stock_admin']));

create or replace function public.stock_niveau()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.role() = 'service_role' then 'admin'
    when exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'stock_admin') then 'admin'
    when exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'stock') then 'comptage'
    else null end;
$$;
comment on function public.stock_niveau() is 'Niveau d''accès au stock du compte : admin (coûts, réglages, validation) | comptage (lecture + comptage, sans coûts) | null. Migration 491.';

create or replace function public.stock_exiger(p_niveau text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := stock_niveau();
begin
  if v is null or (p_niveau = 'admin' and v <> 'admin') then raise exception 'acces_refuse'; end if;
  return v;
end $$;

create or replace function public.ph_mes_droits()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'role', auth_user_powerhouse_role(),
    'bureau', auth_user_is_bureau(),
    'zones', to_jsonb(my_secteurs()),
    'admin', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'admin'),
    'perf', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf'),
    'honoraires', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires'),
    'rembourser', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'rembourser'),
    'stock', stock_niveau()
  );
$$;

create or replace function public.ph_droit_definir(p_uid uuid, p_droit text, p_actif boolean, p_perimetre text default 'tout')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ph_est_admin() then raise exception 'acces_refuse'; end if;
  if p_droit not in ('perf', 'honoraires', 'admin', 'rembourser', 'stock', 'stock_admin') then raise exception 'droit_inconnu'; end if;
  if p_droit = 'rembourser' and coalesce(p_actif, false) and coalesce(nullif(p_perimetre, ''), 'tout') not in ('tout', 'agence:dcb', 'agence:lauian') then
    raise exception 'perimetre_invalide';
  end if;
  if p_droit = 'admin' and not coalesce(p_actif, false)
     and not exists (select 1 from ph_droit d where d.droit = 'admin' and d.auth_user_id <> p_uid) then
    raise exception 'dernier_admin';
  end if;
  if coalesce(p_actif, false) then
    insert into ph_droit (auth_user_id, droit, perimetre, accorde_par)
    values (p_uid, p_droit, case when p_droit in ('stock', 'stock_admin') then 'tout' else coalesce(nullif(p_perimetre, ''), 'tout') end, auth.uid())
    on conflict (auth_user_id, droit) do update
      set perimetre = excluded.perimetre, accorde_par = excluded.accorde_par, accorde_le = now();
  else
    delete from ph_droit where auth_user_id = p_uid and droit = p_droit;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────── tables
create table if not exists public.stock_depot (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  nom text not null,
  type text not null default 'physique' check (type in ('physique', 'virtuel')),
  role text not null default 'stock' check (role in ('stock', 'logements', 'sale')),
  zone text not null default 'cote_basque',
  agence text not null default 'dcb' check (agence in ('dcb', 'lauian')),
  bien_id uuid references public.bien(id) on delete set null,
  codes_zone_sac text[] not null default '{}',
  ordre smallint not null default 0,
  actif boolean not null default true,
  note text,
  cree_le timestamptz not null default now()
);
comment on table public.stock_depot is 'Dépôts du stock : physiques (MFC, Cave ML) + emplacements virtuels du linge circulant (Dans les logements, Au sale). codes_zone_sac = valeurs de tache_sac.zone_sac qui désignent ce dépôt. Migration 491.';

create table if not exists public.stock_article (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  nom text not null,
  famille text not null,
  taille text,
  nature text not null check (nature in ('consomme', 'circulant', 'equipement')),
  unite text not null default 'pièce',
  conditionnement text,
  conditionnement_qte numeric,
  cout_defaut_centimes numeric,
  cmp_centimes numeric,
  catalogue_item_id uuid references public.catalogue_items(id) on delete set null,
  source text,
  repere jsonb not null default '{}'::jsonb,
  a_valider boolean not null default true,
  actif boolean not null default true,
  ordre integer not null default 0,
  note text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
comment on table public.stock_article is 'Articles du stock. nature : consomme (sort définitivement), circulant (linge qui tourne dépôt → logement → sale → dépôt), equipement (durable, sort vers un bien). cmp_centimes = coût moyen pondéré HT maintenu par le journal ; cout_defaut_centimes = estimation saisie (utilisée tant qu''aucune réception chiffrée). repere = chiffres de l''ancien inventaire (ordre de grandeur, PAS un stock). Migration 491.';

create table if not exists public.stock_seuil (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.stock_article(id) on delete cascade,
  depot_id uuid references public.stock_depot(id) on delete cascade,
  seuil_alerte numeric,
  stock_cible numeric,
  maj_le timestamptz not null default now()
);
create unique index if not exists stock_seuil_uniq on public.stock_seuil (article_id, coalesce(depot_id, '00000000-0000-0000-0000-000000000000'::uuid));
comment on table public.stock_seuil is 'Seuil d''alerte et stock cible ; depot_id null = tous les dépôts physiques confondus. Migration 491.';

create table if not exists public.stock_fournisseur (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  contact text, email text, telephone text, site text, note text,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create table if not exists public.stock_reception (
  id uuid primary key default gen_random_uuid(),
  fournisseur_id uuid references public.stock_fournisseur(id) on delete set null,
  depot_id uuid not null references public.stock_depot(id),
  date_reception date not null default current_date,
  reference text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee', 'annulee')),
  note text,
  cree_par uuid, cree_le timestamptz not null default now(),
  valide_par uuid, valide_le timestamptz,
  annule_par uuid, annule_le timestamptz
);
create table if not exists public.stock_reception_ligne (
  id uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.stock_reception(id) on delete cascade,
  article_id uuid not null references public.stock_article(id),
  quantite numeric not null check (quantite > 0),
  cout_unitaire_centimes numeric check (cout_unitaire_centimes is null or cout_unitaire_centimes >= 0),
  mouvement_id uuid
);

create table if not exists public.stock_mouvement (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  date_effet date not null default current_date,
  article_id uuid not null references public.stock_article(id),
  depot_id uuid not null references public.stock_depot(id),
  quantite numeric not null check (quantite <> 0),
  type text not null check (type in (
    'stock_initial', 'ecart_comptage', 'reception', 'transfert',
    'sortie_sac', 'sortie_recouche', 'sortie_besoin_sac', 'dotation_ae', 'usage_bureau',
    'perte', 'casse', 'jete', 'don', 'ajustement', 'annulation')),
  cout_unitaire_centimes numeric,
  valeur_centimes numeric,
  operation_id uuid not null default gen_random_uuid(),
  cle_source text,
  source_type text,
  source_id text,
  annule_mouvement_id uuid references public.stock_mouvement(id),
  agence text not null default 'dcb' check (agence in ('dcb', 'lauian')),
  bien_id uuid references public.bien(id) on delete set null,
  mission_id uuid,
  ae_id uuid,
  a_verifier boolean not null default false,
  note text,
  auteur uuid
);
create unique index if not exists stock_mouvement_cle_source on public.stock_mouvement (cle_source) where cle_source is not null;
create unique index if not exists stock_mouvement_annule_une_fois on public.stock_mouvement (annule_mouvement_id) where annule_mouvement_id is not null;
create index if not exists stock_mouvement_article_depot on public.stock_mouvement (article_id, depot_id);
create index if not exists stock_mouvement_date on public.stock_mouvement (date_effet desc, cree_le desc);
create index if not exists stock_mouvement_operation on public.stock_mouvement (operation_id);
comment on table public.stock_mouvement is 'Journal IMMUABLE du stock (ni modification ni suppression). Quantité signée (+ entrée, − sortie). Coût unitaire figé (CMP au moment du mouvement). cle_source unique = anti-doublon (ex. sac:<mission>:<article>). Annulation = mouvement inverse de type « annulation » (annule_mouvement_id, une seule fois). agence = société qui consomme (valeur visible, aucune refacturation DCB↔Lauïan). Migration 491.';

create table if not exists public.stock_solde (
  article_id uuid not null references public.stock_article(id) on delete cascade,
  depot_id uuid not null references public.stock_depot(id) on delete cascade,
  quantite numeric not null default 0,
  valeur_centimes numeric not null default 0,
  maj_le timestamptz not null default now(),
  primary key (article_id, depot_id)
);
comment on table public.stock_solde is 'Solde par article × dépôt = somme du journal (déclencheur) ; contrôlé chaque nuit (stock_controle_soldes). Migration 491.';

create table if not exists public.stock_controle (
  id bigserial primary key,
  fait_le timestamptz not null default now(),
  nb_ecarts integer not null default 0,
  detail jsonb not null default '[]'::jsonb
);

create table if not exists public.stock_comptage (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  date_comptage date not null default current_date,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'soumis', 'valide', 'annule')),
  depots uuid[] not null,
  est_initial boolean,
  note text,
  cree_par uuid, cree_le timestamptz not null default now(),
  soumis_par uuid, soumis_le timestamptz,
  valide_par uuid, valide_le timestamptz,
  annule_par uuid, annule_le timestamptz,
  bilan jsonb
);
comment on table public.stock_comptage is 'Inventaire guidé (comptage). Linge : dépôts + Dans les logements + Au sale. Validation (stock_admin) → mouvements stock_initial (1er inventaire validé) ou ecart_comptage chiffrés ; bilan = parc total, écarts, pertes. Migration 491.';

create table if not exists public.stock_comptage_ligne (
  id uuid primary key default gen_random_uuid(),
  comptage_id uuid not null references public.stock_comptage(id) on delete cascade,
  article_id uuid not null references public.stock_article(id),
  depot_id uuid not null references public.stock_depot(id),
  quantite_comptee numeric check (quantite_comptee is null or quantite_comptee >= 0),
  quantite_proposee numeric,
  quantite_theorique numeric,
  ecart numeric,
  mouvement_id uuid,
  compte_par uuid, compte_le timestamptz,
  note text,
  unique (comptage_id, article_id, depot_id)
);

create table if not exists public.stock_libelle_article (
  libelle text primary key,
  article_id uuid references public.stock_article(id) on delete set null,
  statut text not null default 'a_relier' check (statut in ('relie', 'a_relier', 'ignore')),
  exemple text,
  occurrences integer not null default 0,
  maj_le timestamptz not null default now(),
  maj_par uuid
);
comment on table public.stock_libelle_article is 'Dictionnaire des libellés des étiquettes de sacs (normalisés : minuscules, sans accents, singulier) → article. a_relier = ligne non reconnue, à relier par le bureau. Migration 491.';

create table if not exists public.stock_nomenclature_sac (
  id bigserial primary key,
  sac_id uuid not null references public.bien_sac_preparation(id) on delete cascade,
  bien_id uuid,
  bloc text,
  ligne text not null,
  segment text not null,
  libelle text not null,
  quantite numeric not null,
  pax_min integer,
  article_id uuid references public.stock_article(id) on delete set null,
  ordre integer not null default 0
);
create index if not exists stock_nomenclature_sac_sac on public.stock_nomenclature_sac (sac_id);
comment on table public.stock_nomenclature_sac is 'Contenu de chaque sac (bien_sac_preparation) traduit en articles via stock_libelle_article. pax_min non nul = règle « Si N PAX ». Recalculé à chaque modification d''étiquette. Prépare les sorties automatiques (lot 2). Migration 491.';

do $$ declare t text; begin
  foreach t in array array['stock_depot','stock_article','stock_seuil','stock_fournisseur','stock_reception','stock_reception_ligne',
    'stock_mouvement','stock_solde','stock_controle','stock_comptage','stock_comptage_ligne','stock_libelle_article','stock_nomenclature_sac'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────── journal : immuable, coût figé, soldes
create or replace function public.stock_mouvement_immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'journal_immuable : un mouvement de stock ne se modifie ni ne se supprime (annuler = mouvement inverse)';
end $$;
drop trigger if exists trg_stock_mouvement_immuable on public.stock_mouvement;
create trigger trg_stock_mouvement_immuable before update or delete on public.stock_mouvement
  for each row execute function public.stock_mouvement_immuable();

create or replace function public.stock_mouvement_avant()
returns trigger language plpgsql security definer set search_path = public as $$
declare a stock_article; q_tot numeric; c_base numeric; orig stock_mouvement;
begin
  select * into a from stock_article where id = new.article_id for update;
  if not found then raise exception 'article_inconnu'; end if;
  select coalesce(sum(quantite), 0) into q_tot from stock_solde where article_id = new.article_id;
  c_base := coalesce(a.cmp_centimes, a.cout_defaut_centimes);
  if new.type = 'reception' and new.quantite > 0 and new.cout_unitaire_centimes is not null then
    -- Coût moyen pondéré : (stock existant × CMP + entrée × coût) / total (stock existant valorisé au coût de
    -- l'entrée si aucun coût connu)
    update stock_article set cmp_centimes = case when q_tot + new.quantite > 0 and q_tot > 0
        then round((q_tot * coalesce(c_base, new.cout_unitaire_centimes) + new.quantite * new.cout_unitaire_centimes) / (q_tot + new.quantite), 4)
        else new.cout_unitaire_centimes end, maj_le = now()
     where id = new.article_id;
  elsif new.type = 'annulation' and new.annule_mouvement_id is not null then
    select * into orig from stock_mouvement where id = new.annule_mouvement_id;
    new.cout_unitaire_centimes := orig.cout_unitaire_centimes;
    if orig.type = 'reception' and orig.cout_unitaire_centimes is not null and q_tot + new.quantite > 0 and a.cmp_centimes is not null then
      update stock_article set cmp_centimes = greatest(0, round((q_tot * a.cmp_centimes + new.quantite * orig.cout_unitaire_centimes) / (q_tot + new.quantite), 4)), maj_le = now()
       where id = new.article_id;
    end if;
  elsif new.cout_unitaire_centimes is null then
    new.cout_unitaire_centimes := c_base;  -- sorties, transferts, écarts : au CMP du moment (figé)
  end if;
  new.valeur_centimes := case when new.cout_unitaire_centimes is null then null else round(new.quantite * new.cout_unitaire_centimes, 2) end;
  return new;
end $$;
drop trigger if exists trg_stock_mouvement_avant on public.stock_mouvement;
create trigger trg_stock_mouvement_avant before insert on public.stock_mouvement
  for each row execute function public.stock_mouvement_avant();

create or replace function public.stock_mouvement_apres()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into stock_solde (article_id, depot_id, quantite, valeur_centimes, maj_le)
  values (new.article_id, new.depot_id, new.quantite, coalesce(new.valeur_centimes, 0), now())
  on conflict (article_id, depot_id) do update
    set quantite = stock_solde.quantite + excluded.quantite,
        valeur_centimes = stock_solde.valeur_centimes + excluded.valeur_centimes,
        maj_le = now();
  return null;
end $$;
drop trigger if exists trg_stock_mouvement_apres on public.stock_mouvement;
create trigger trg_stock_mouvement_apres after insert on public.stock_mouvement
  for each row execute function public.stock_mouvement_apres();
revoke all on function public.stock_mouvement_avant() from public, anon, authenticated;
revoke all on function public.stock_mouvement_apres() from public, anon, authenticated;

-- Insertion unique (toutes les écritures passent par ici). Renvoie l'id, ou null si la cle_source existe déjà.
create or replace function public.stock_mouvement_inserer(
  p_article uuid, p_depot uuid, p_quantite numeric, p_type text,
  p_cle text default null, p_cout numeric default null, p_operation uuid default null,
  p_date date default current_date, p_note text default null, p_agence text default 'dcb',
  p_bien uuid default null, p_mission uuid default null, p_ae uuid default null,
  p_source_type text default null, p_source_id text default null, p_a_verifier boolean default false,
  p_annule uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_quantite, 0) = 0 then return null; end if;
  insert into stock_mouvement (article_id, depot_id, quantite, type, cle_source, cout_unitaire_centimes, operation_id,
    date_effet, note, agence, bien_id, mission_id, ae_id, source_type, source_id, a_verifier, annule_mouvement_id, auteur)
  values (p_article, p_depot, p_quantite, p_type, p_cle, p_cout, coalesce(p_operation, gen_random_uuid()),
    coalesce(p_date, current_date), p_note, coalesce(p_agence, 'dcb'), p_bien, p_mission, p_ae, p_source_type, p_source_id,
    coalesce(p_a_verifier, false), p_annule, auth.uid())
  on conflict (cle_source) where cle_source is not null do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.stock_mouvement_inserer(uuid, uuid, numeric, text, text, numeric, uuid, date, text, text, uuid, uuid, uuid, text, text, boolean, uuid) from public, anon, authenticated;

-- Contrôle nocturne : soldes = somme du journal ; corrige et journalise les écarts.
create or replace function public.stock_controle_soldes()
returns integer language plpgsql security definer set search_path = public as $$
declare v_detail jsonb; v_n integer;
begin
  with j as (
    select article_id, depot_id, sum(quantite) q, sum(coalesce(valeur_centimes, 0)) v from stock_mouvement group by 1, 2
  ), d as (
    select coalesce(j.article_id, s.article_id) article_id, coalesce(j.depot_id, s.depot_id) depot_id,
           coalesce(j.q, 0) q_journal, coalesce(s.quantite, 0) q_solde, coalesce(j.v, 0) v_journal, coalesce(s.valeur_centimes, 0) v_solde
      from j full join stock_solde s on s.article_id = j.article_id and s.depot_id = j.depot_id
  )
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb), count(*) into v_detail, v_n
    from d where q_journal <> q_solde or abs(v_journal - v_solde) > 0.01;
  if v_n > 0 then
    insert into stock_solde (article_id, depot_id, quantite, valeur_centimes, maj_le)
    select (x->>'article_id')::uuid, (x->>'depot_id')::uuid, (x->>'q_journal')::numeric, (x->>'v_journal')::numeric, now()
      from jsonb_array_elements(v_detail) x
    on conflict (article_id, depot_id) do update set quantite = excluded.quantite, valeur_centimes = excluded.valeur_centimes, maj_le = now();
  end if;
  insert into stock_controle (nb_ecarts, detail) values (v_n, v_detail);
  delete from stock_controle where fait_le < now() - interval '120 days';
  return v_n;
end $$;
revoke all on function public.stock_controle_soldes() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('stock-controle-soldes') where exists (select 1 from cron.job where jobname = 'stock-controle-soldes');
  perform cron.schedule('stock-controle-soldes', '40 3 * * *', 'select public.stock_controle_soldes()');
end $$;

-- ─────────────────────────────────────────────────────────────── libellés des étiquettes → articles
create or replace function public.stock_normaliser(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select coalesce(string_agg(case when length(w) > 3 and w ~ '[sx]$' and w !~ 'ss$' then left(w, length(w) - 1) else w end, ' ' order by i), '')
    from unnest(regexp_split_to_array(
      trim(regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[«»<>"()’''.,:;!?/]', ' ', 'g'), '\s+', ' ', 'g')),
      ' ')) with ordinality as t(w, i)
   where w <> '';
$$;
comment on function public.stock_normaliser(text) is 'Normalise un libellé d''étiquette : minuscules, sans accents ni ponctuation, mots de plus de 3 lettres au singulier (s/x final retiré). Migration 491.';

-- « 2 Taies Carrées + 2 Taies rectangles » → (2, taie carree), (2, taie rectangle). Sans nombre → 1.
create or replace function public.stock_decouper_ligne(p_ligne text)
returns table (ordre integer, segment text, quantite numeric, libelle text)
language sql immutable set search_path = public, extensions as $$
  select i::int, trim(s),
         coalesce(replace((regexp_match(trim(s), '^(\d+(?:[.,]\d+)?)'))[1], ',', '.')::numeric, 1),
         stock_normaliser(regexp_replace(trim(s), '^\d+(?:[.,]\d+)?\s*', ''))
    from unnest(string_to_array(coalesce(p_ligne, ''), '+')) with ordinality as t(s, i)
   where trim(s) <> '';
$$;

create or replace function public.stock_nomenclature_recalculer(p_sac uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from stock_nomenclature_sac where p_sac is null or sac_id = p_sac;
  with l as (
    select s.id sac_id, s.bien_id, b.titre bloc, x.v ligne, null::int pax_min, (bo * 100 + lo)::int o
      from bien_sac_preparation s
      cross join lateral jsonb_array_elements(coalesce(s.blocs, '[]')) with ordinality as bb(b0, bo)
      cross join lateral (select bb.b0->>'titre' titre) b
      cross join lateral jsonb_array_elements_text(coalesce(bb.b0->'lignes', '[]')) with ordinality as x(v, lo)
     where s.actif and (p_sac is null or s.id = p_sac)
    union all
    select s.id, s.bien_id, r.r0->>'texte', x.v, nullif(r.r0->>'pax_min', '')::int, (10000 + ro * 100 + lo)::int
      from bien_sac_preparation s
      cross join lateral jsonb_array_elements(coalesce(s.regles_pax, '[]')) with ordinality as r(r0, ro)
      cross join lateral jsonb_array_elements_text(coalesce(r.r0->'lignes', '[]')) with ordinality as x(v, lo)
     where s.actif and (p_sac is null or s.id = p_sac)
  ), seg as (
    select l.*, d.ordre so, d.segment, d.quantite, d.libelle from l cross join lateral stock_decouper_ligne(l.ligne) d
  ), ins as (
    insert into stock_nomenclature_sac (sac_id, bien_id, bloc, ligne, segment, libelle, quantite, pax_min, article_id, ordre)
    select seg.sac_id, seg.bien_id, seg.bloc, seg.ligne, seg.segment, seg.libelle, seg.quantite, seg.pax_min,
           (select la.article_id from stock_libelle_article la where la.libelle = seg.libelle and la.statut = 'relie'),
           seg.o * 10 + seg.so
      from seg where seg.libelle <> ''
    returning libelle, segment
  ), nouv as (
    insert into stock_libelle_article (libelle, exemple, occurrences)
    select libelle, min(segment), count(*) from ins group by libelle
    on conflict (libelle) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  -- occurrences à jour (toutes étiquettes)
  update stock_libelle_article la set occurrences = coalesce((select count(*) from stock_nomenclature_sac n where n.libelle = la.libelle), 0);
  return v_n;
end $$;
revoke all on function public.stock_nomenclature_recalculer(uuid) from public, anon, authenticated;

create or replace function public.stock_sac_preparation_maj()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  perform stock_nomenclature_recalculer(new.id);
  return new;
end $$;
drop trigger if exists trg_stock_sac_preparation_maj on public.bien_sac_preparation;
create trigger trg_stock_sac_preparation_maj after insert or update of blocs, regles_pax, actif on public.bien_sac_preparation
  for each row execute function public.stock_sac_preparation_maj();
revoke all on function public.stock_sac_preparation_maj() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────── linge en place dans les logements (proposition)
-- Proposition pour l'emplacement « Dans les logements » : chaque logement actif de la zone dont le sac est connu
-- (bien_sac_preparation) garde UN jeu de linge circulant (lits faits + salle de bain) — en service pendant un
-- séjour, ou propre en attente de la prochaine arrivée. Actif = séjour en cours, arrivée dans les 30 jours ou
-- ménage de départ dans les 30 derniers jours. Seul le linge qui RESTE au logement compte (familles linge de lit,
-- de bain, de cuisine) : microfibres de ménage, serpillères et sacs à linge repartent avec l'AE. Règles « Si N PAX » : appliquées si le séjour en cours / suivant
-- a au moins N voyageurs. C'est une PROPOSITION : le comptage reste la vérité (le bureau corrige).
create or replace function public.stock_linge_en_place(p_zone text default 'cote_basque')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform stock_exiger('comptage');
  with b as (
    select bi.id, bi.code, bi.agence,
      (select r from reservation r where r.bien_id = bi.id and r.final_status = 'accepted' and r.departure_date > current_date
         order by r.arrival_date limit 1) r,
      (select max(mm.date_mission) from mission_menage mm where mm.bien_id = bi.id and mm.type_mission = 'checkout'
         and mm.statut <> 'cancelled' and mm.date_mission between current_date - 30 and current_date) dernier_menage
      from bien bi
     where coalesce(bi.zone_logistique, 'cote_basque') = p_zone
       and exists (select 1 from bien_sac_preparation s where s.bien_id = bi.id and s.actif)
  ), act as (
    select b.*, (b.r).arrival_date arrivee, (b.r).departure_date depart, (b.r).guest_count voyageurs,
      case when (b.r).arrival_date <= current_date then 'séjour en cours'
           when (b.r).arrival_date <= current_date + 30 then 'arrivée le ' || to_char((b.r).arrival_date, 'DD/MM/YYYY')
           when b.dernier_menage is not null then 'ménage le ' || to_char(b.dernier_menage, 'DD/MM/YYYY') end raison
      from b
  ), lignes as (
    select a.id bien_id, n.article_id, sum(n.quantite) q
      from act a join bien_sac_preparation s on s.bien_id = a.id and s.actif
      join stock_nomenclature_sac n on n.sac_id = s.id
      join stock_article ar on ar.id = n.article_id and ar.nature = 'circulant' and ar.famille in ('linge_lit', 'linge_bain', 'linge_cuisine')
     where a.raison is not null and (n.pax_min is null or coalesce(a.voyageurs, 0) >= n.pax_min)
     group by 1, 2
  )
  select jsonb_build_object(
    'biens', coalesce((select jsonb_agg(jsonb_build_object('bien_id', a.id, 'code', a.code, 'agence', a.agence, 'raison', a.raison,
                 'voyageurs', a.voyageurs, 'en_place', a.raison is not null,
                 'lignes', coalesce((select jsonb_object_agg(l.article_id, l.q) from lignes l where l.bien_id = a.id), '{}'::jsonb))
               order by a.raison is null, a.code) from act a), '[]'::jsonb),
    'total', coalesce((select jsonb_object_agg(article_id, q) from (select article_id, sum(q) q from lignes group by 1) t), '{}'::jsonb)
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────── lecture
create or replace function public.stock_etat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_niv text := stock_exiger('comptage'); adm boolean := (v_niv = 'admin');
begin
  return jsonb_build_object(
    'niveau', v_niv,
    'depots', (select coalesce(jsonb_agg(to_jsonb(d) order by d.ordre, d.nom), '[]') from stock_depot d),
    'articles', (select coalesce(jsonb_agg(
        (to_jsonb(a) - case when adm then '{}'::text[] else array['cout_defaut_centimes', 'cmp_centimes'] end)
        || jsonb_build_object('cout_centimes', case when adm then coalesce(a.cmp_centimes, a.cout_defaut_centimes) end)
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

create or replace function public.stock_mouvements(p_limite integer default 200, p_article uuid default null, p_depot uuid default null,
  p_type text default null, p_du date default null, p_au date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_niv text := stock_exiger('comptage'); adm boolean := (v_niv = 'admin');
begin
  return (select coalesce(jsonb_agg(x order by x->>'cree_le' desc), '[]') from (
    select (to_jsonb(m) - case when adm then '{}'::text[] else array['cout_unitaire_centimes', 'valeur_centimes'] end)
           || jsonb_build_object('annule', exists (select 1 from stock_mouvement z where z.annule_mouvement_id = m.id),
                                 'bien_code', (select code from bien where id = m.bien_id),
                                 'auteur_email', (select email from auth.users u where u.id = m.auteur)) x
      from stock_mouvement m
     where (p_article is null or m.article_id = p_article) and (p_depot is null or m.depot_id = p_depot)
       and (p_type is null or m.type = p_type) and (p_du is null or m.date_effet >= p_du) and (p_au is null or m.date_effet <= p_au)
     order by m.cree_le desc limit least(greatest(coalesce(p_limite, 200), 1), 2000)) t);
end $$;

-- ─────────────────────────────────────────────────────────────── saisies (stock_admin)
-- p : {article_id, depot_id, quantite (>0), type, vers_depot_id (transfert), date, note, agence, bien_id, ae_id, cle}
-- Sorties (perte, casse, jete, don, dotation_ae, usage_bureau, sortie_*) : quantité retirée du dépôt.
-- Transfert : − au dépôt de départ, + au dépôt d'arrivée (même opération). Ajustement : quantité signée.
create or replace function public.stock_mouvement_saisir(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text := p->>'type'; v_q numeric := (p->>'quantite')::numeric; v_op uuid := gen_random_uuid();
  v_art uuid := (p->>'article_id')::uuid; v_dep uuid := (p->>'depot_id')::uuid; v_vers uuid := nullif(p->>'vers_depot_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'date', '')::date, current_date); v_cle text := nullif(p->>'cle', ''); v1 uuid; v2 uuid;
begin
  perform stock_exiger('admin');
  if v_art is null or v_dep is null or coalesce(v_q, 0) = 0 then raise exception 'saisie_incomplete'; end if;
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

create or replace function public.stock_mouvement_annuler(p_id uuid, p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m stock_mouvement; n integer := 0; v uuid;
begin
  perform stock_exiger('admin');
  select * into m from stock_mouvement where id = p_id;
  if not found then raise exception 'mouvement_inconnu'; end if;
  if m.type = 'annulation' then raise exception 'annulation_d_annulation'; end if;
  if m.source_type in ('comptage', 'reception') then raise exception 'annuler_depuis_la_source'; end if;
  for m in select * from stock_mouvement where operation_id = m.operation_id and type <> 'annulation' loop
    if exists (select 1 from stock_mouvement z where z.annule_mouvement_id = m.id) then continue; end if;
    v := stock_mouvement_inserer(m.article_id, m.depot_id, -m.quantite, 'annulation', 'annulation:' || m.id, null, null, current_date,
      coalesce(nullif(p_motif, ''), 'Annulation'), m.agence, m.bien_id, m.mission_id, m.ae_id, m.source_type, m.source_id, false, m.id);
    if v is not null then n := n + 1; end if;
  end loop;
  if n = 0 then raise exception 'deja_annule'; end if;
  return jsonb_build_object('ok', true, 'annules', n);
end $$;

create or replace function public.stock_article_enregistrer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  perform stock_exiger('admin');
  if v_id is null then
    insert into stock_article (code, nom, famille, taille, nature, unite, conditionnement, conditionnement_qte, cout_defaut_centimes,
      catalogue_item_id, source, a_valider, actif, ordre, note)
    values (upper(trim(p->>'code')), trim(p->>'nom'), coalesce(nullif(p->>'famille', ''), 'autre'), nullif(p->>'taille', ''),
      coalesce(nullif(p->>'nature', ''), 'consomme'), coalesce(nullif(p->>'unite', ''), 'pièce'), nullif(p->>'conditionnement', ''),
      nullif(p->>'conditionnement_qte', '')::numeric, nullif(p->>'cout_defaut_centimes', '')::numeric,
      nullif(p->>'catalogue_item_id', '')::uuid, 'bureau', false, coalesce((p->>'actif')::boolean, true),
      coalesce(nullif(p->>'ordre', '')::int, 9000), nullif(p->>'note', ''))
    returning id into v_id;
  else
    update stock_article set
      code = coalesce(upper(nullif(trim(p->>'code'), '')), code), nom = coalesce(nullif(trim(p->>'nom'), ''), nom),
      famille = coalesce(nullif(p->>'famille', ''), famille), taille = case when p ? 'taille' then nullif(p->>'taille', '') else taille end,
      nature = coalesce(nullif(p->>'nature', ''), nature), unite = coalesce(nullif(p->>'unite', ''), unite),
      conditionnement = case when p ? 'conditionnement' then nullif(p->>'conditionnement', '') else conditionnement end,
      conditionnement_qte = case when p ? 'conditionnement_qte' then nullif(p->>'conditionnement_qte', '')::numeric else conditionnement_qte end,
      cout_defaut_centimes = case when p ? 'cout_defaut_centimes' then nullif(p->>'cout_defaut_centimes', '')::numeric else cout_defaut_centimes end,
      catalogue_item_id = case when p ? 'catalogue_item_id' then nullif(p->>'catalogue_item_id', '')::uuid else catalogue_item_id end,
      a_valider = coalesce((p->>'a_valider')::boolean, a_valider), actif = coalesce((p->>'actif')::boolean, actif),
      ordre = coalesce(nullif(p->>'ordre', '')::int, ordre), note = case when p ? 'note' then nullif(p->>'note', '') else note end,
      maj_le = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.stock_depot_enregistrer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  perform stock_exiger('admin');
  if v_id is null then
    insert into stock_depot (code, nom, type, role, zone, codes_zone_sac, ordre, actif, note)
    values (upper(trim(p->>'code')), trim(p->>'nom'), 'physique', 'stock', coalesce(nullif(p->>'zone', ''), 'cote_basque'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(p->'codes_zone_sac') x), '{}'), coalesce(nullif(p->>'ordre', '')::int, 50),
      coalesce((p->>'actif')::boolean, true), nullif(p->>'note', ''))
    returning id into v_id;
  else
    update stock_depot set nom = coalesce(nullif(trim(p->>'nom'), ''), nom), zone = coalesce(nullif(p->>'zone', ''), zone),
      codes_zone_sac = case when p ? 'codes_zone_sac' then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'codes_zone_sac') x), '{}') else codes_zone_sac end,
      actif = coalesce((p->>'actif')::boolean, actif), note = case when p ? 'note' then nullif(p->>'note', '') else note end
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.stock_seuil_definir(p_article uuid, p_depot uuid, p_seuil numeric, p_cible numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform stock_exiger('admin');
  delete from stock_seuil where article_id = p_article and depot_id is not distinct from p_depot;
  if p_seuil is not null or p_cible is not null then
    insert into stock_seuil (article_id, depot_id, seuil_alerte, stock_cible) values (p_article, p_depot, p_seuil, p_cible);
  end if;
end $$;

create or replace function public.stock_fournisseur_enregistrer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  perform stock_exiger('admin');
  if v_id is null then
    insert into stock_fournisseur (nom, contact, email, telephone, site, note)
    values (trim(p->>'nom'), nullif(p->>'contact', ''), nullif(p->>'email', ''), nullif(p->>'telephone', ''), nullif(p->>'site', ''), nullif(p->>'note', ''))
    returning id into v_id;
  else
    update stock_fournisseur set nom = coalesce(nullif(trim(p->>'nom'), ''), nom), contact = nullif(p->>'contact', ''), email = nullif(p->>'email', ''),
      telephone = nullif(p->>'telephone', ''), site = nullif(p->>'site', ''), note = nullif(p->>'note', ''),
      actif = coalesce((p->>'actif')::boolean, actif) where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.stock_libelle_relier(p_libelle text, p_article uuid, p_statut text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_statut text := coalesce(p_statut, case when p_article is null then 'a_relier' else 'relie' end);
begin
  perform stock_exiger('admin');
  if v_statut not in ('relie', 'a_relier', 'ignore') then raise exception 'statut_invalide'; end if;
  update stock_libelle_article set article_id = case when v_statut = 'relie' then p_article end, statut = v_statut, maj_le = now(), maj_par = auth.uid()
   where libelle = p_libelle;
  update stock_nomenclature_sac set article_id = case when v_statut = 'relie' then p_article end where libelle = p_libelle;
  return (select count(*) from stock_nomenclature_sac where libelle = p_libelle);
end $$;

-- Réception : p {id?, fournisseur_id, depot_id, date, reference, note, lignes:[{article_id, quantite, cout_unitaire_centimes}], valider}
create or replace function public.stock_reception_enregistrer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; r stock_reception; l record; v_m uuid;
begin
  perform stock_exiger('admin');
  if v_id is null then
    insert into stock_reception (fournisseur_id, depot_id, date_reception, reference, note, cree_par)
    values (nullif(p->>'fournisseur_id', '')::uuid, (p->>'depot_id')::uuid, coalesce(nullif(p->>'date', '')::date, current_date),
      nullif(p->>'reference', ''), nullif(p->>'note', ''), auth.uid()) returning id into v_id;
  else
    select * into r from stock_reception where id = v_id;
    if r.statut <> 'brouillon' then raise exception 'reception_figee'; end if;
    update stock_reception set fournisseur_id = nullif(p->>'fournisseur_id', '')::uuid, depot_id = (p->>'depot_id')::uuid,
      date_reception = coalesce(nullif(p->>'date', '')::date, date_reception), reference = nullif(p->>'reference', ''), note = nullif(p->>'note', '')
     where id = v_id;
  end if;
  if p ? 'lignes' then
    delete from stock_reception_ligne where reception_id = v_id;
    insert into stock_reception_ligne (reception_id, article_id, quantite, cout_unitaire_centimes)
    select v_id, (x->>'article_id')::uuid, (x->>'quantite')::numeric, nullif(x->>'cout_unitaire_centimes', '')::numeric
      from jsonb_array_elements(p->'lignes') x where coalesce((x->>'quantite')::numeric, 0) > 0 and nullif(x->>'article_id', '') is not null;
  end if;
  if coalesce((p->>'valider')::boolean, false) then
    select * into r from stock_reception where id = v_id;
    if not exists (select 1 from stock_reception_ligne where reception_id = v_id) then raise exception 'reception_vide'; end if;
    for l in select * from stock_reception_ligne where reception_id = v_id loop
      v_m := stock_mouvement_inserer(l.article_id, r.depot_id, l.quantite, 'reception', 'reception:' || l.id, l.cout_unitaire_centimes,
        v_id, r.date_reception, r.reference, 'dcb', null, null, null, 'reception', v_id::text);
      update stock_reception_ligne set mouvement_id = v_m where id = l.id;
    end loop;
    update stock_reception set statut = 'validee', valide_par = auth.uid(), valide_le = now() where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.stock_reception_annuler(p_id uuid, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r stock_reception; m stock_mouvement;
begin
  perform stock_exiger('admin');
  select * into r from stock_reception where id = p_id for update;
  if r.statut = 'annulee' then raise exception 'deja_annule'; end if;
  if r.statut = 'validee' then
    for m in select * from stock_mouvement where source_type = 'reception' and source_id = p_id::text and type = 'reception' loop
      perform stock_mouvement_inserer(m.article_id, m.depot_id, -m.quantite, 'annulation', 'annulation:' || m.id, null, null, current_date,
        coalesce(nullif(p_motif, ''), 'Réception annulée'), m.agence, null, null, null, 'reception', p_id::text, false, m.id);
    end loop;
  end if;
  update stock_reception set statut = 'annulee', annule_par = auth.uid(), annule_le = now() where id = p_id;
end $$;

create or replace function public.stock_receptions(p_limite integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform stock_exiger('admin');
  return (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'fournisseur', (select nom from stock_fournisseur f where f.id = r.fournisseur_id),
      'lignes', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from stock_reception_ligne l where l.reception_id = r.id),
      'total_centimes', (select sum(l.quantite * l.cout_unitaire_centimes) from stock_reception_ligne l where l.reception_id = r.id))
      order by r.date_reception desc, r.cree_le desc), '[]')
    from (select * from stock_reception order by date_reception desc, cree_le desc limit p_limite) r);
end $$;

-- ─────────────────────────────────────────────────────────────── inventaires (comptages)
create or replace function public.stock_comptage_ouvrir(p_titre text default null, p_depots uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform stock_exiger('comptage');
  if exists (select 1 from stock_comptage where statut in ('en_cours', 'soumis')) then raise exception 'comptage_deja_ouvert'; end if;
  insert into stock_comptage (titre, depots, cree_par)
  values (coalesce(nullif(trim(p_titre), ''), 'Inventaire du ' || to_char(current_date, 'DD/MM/YYYY')),
          coalesce(p_depots, (select array_agg(id order by ordre) from stock_depot where actif)), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.stock_comptage_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_niv text := stock_exiger('comptage'); adm boolean := (v_niv = 'admin'); c stock_comptage;
begin
  select * into c from stock_comptage where id = p_id;
  if not found then raise exception 'comptage_inconnu'; end if;
  return jsonb_build_object(
    'comptage', to_jsonb(c) - case when adm then '{}'::text[] else array['bilan'] end,
    'lignes', (select coalesce(jsonb_agg(
        (to_jsonb(l) - case when adm or c.statut = 'valide' then '{}'::text[] else array['quantite_theorique', 'ecart'] end)
        || jsonb_build_object('compte_par_email', (select email from auth.users u where u.id = l.compte_par))), '[]')
        from stock_comptage_ligne l where l.comptage_id = p_id),
    -- Théorique (solde du journal) : visible par stock_admin seulement, pour ne pas influencer le comptage
    'theorique', case when adm then (select coalesce(jsonb_agg(jsonb_build_object('article_id', s.article_id, 'depot_id', s.depot_id, 'quantite', s.quantite)), '[]')
        from stock_solde s where s.depot_id = any (c.depots) and s.quantite <> 0) end,
    'linge_en_place', case when c.statut in ('en_cours', 'soumis') then stock_linge_en_place(coalesce((select zone from stock_depot where id = c.depots[1]), 'cote_basque')) end
  );
end $$;

-- p_quantite null = efface la saisie ; p_ajout = ajoute à la valeur existante (boutons + / −)
create or replace function public.stock_comptage_saisir(p_id uuid, p_article uuid, p_depot uuid, p_quantite numeric,
  p_ajout boolean default false, p_proposee numeric default null, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare c stock_comptage; v numeric;
begin
  perform stock_exiger('comptage');
  select * into c from stock_comptage where id = p_id;
  if c.statut <> 'en_cours' then raise exception 'comptage_ferme'; end if;
  if not (p_depot = any (c.depots)) then raise exception 'depot_hors_comptage'; end if;
  if (select role from stock_depot where id = p_depot) <> 'stock'
     and (select nature from stock_article where id = p_article) <> 'circulant' then raise exception 'emplacement_reserve_au_linge'; end if;
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

create or replace function public.stock_comptage_statut(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c stock_comptage; lg record; v_theo numeric; v_ecart numeric; v_m uuid; v_initial boolean; v_bilan jsonb;
begin
  select * into c from stock_comptage where id = p_id for update;
  if not found then raise exception 'comptage_inconnu'; end if;
  if p_action = 'soumettre' then
    perform stock_exiger('comptage');
    if c.statut <> 'en_cours' then raise exception 'comptage_ferme'; end if;
    update stock_comptage set statut = 'soumis', soumis_par = auth.uid(), soumis_le = now() where id = p_id;
  elsif p_action = 'rouvrir' then
    perform stock_exiger('comptage');
    if c.statut <> 'soumis' then raise exception 'comptage_non_soumis'; end if;
    update stock_comptage set statut = 'en_cours' where id = p_id;
  elsif p_action = 'annuler' then
    perform stock_exiger('admin');
    if c.statut not in ('en_cours', 'soumis') then raise exception 'comptage_ferme'; end if;
    update stock_comptage set statut = 'annule', annule_par = auth.uid(), annule_le = now() where id = p_id;
  elsif p_action = 'valider' then
    perform stock_exiger('admin');
    if c.statut not in ('en_cours', 'soumis') then raise exception 'comptage_ferme'; end if;
    v_initial := not exists (select 1 from stock_comptage where statut = 'valide');
    for lg in select * from stock_comptage_ligne where comptage_id = p_id and quantite_comptee is not null loop
      select coalesce(quantite, 0) into v_theo from stock_solde where article_id = lg.article_id and depot_id = lg.depot_id;
      v_theo := coalesce(v_theo, 0);
      v_ecart := lg.quantite_comptee - v_theo;
      v_m := null;
      if v_ecart <> 0 then
        v_m := stock_mouvement_inserer(lg.article_id, lg.depot_id, v_ecart, case when v_initial then 'stock_initial' else 'ecart_comptage' end,
          'comptage:' || p_id || ':' || lg.article_id || ':' || lg.depot_id, null, p_id, c.date_comptage, c.titre, 'dcb', null, null, null,
          'comptage', p_id::text);
      end if;
      update stock_comptage_ligne set quantite_theorique = v_theo, ecart = v_ecart, mouvement_id = v_m where id = lg.id;
    end loop;
    -- Bilan : par article, parc total (tous emplacements comptés) théorique vs compté, écart net, valeur
    with x as (
      select l.article_id, sum(l.quantite_theorique) theo, sum(l.quantite_comptee) compte, sum(l.ecart) ecart,
             sum(coalesce(m.valeur_centimes, 0)) valeur, bool_or(m.id is not null and m.valeur_centimes is null) sans_cout,
             jsonb_object_agg(l.depot_id, l.quantite_comptee) par_depot
        from stock_comptage_ligne l left join stock_mouvement m on m.id = l.mouvement_id
       where l.comptage_id = p_id and l.quantite_comptee is not null group by 1
    )
    select jsonb_build_object('initial', v_initial,
      'articles', coalesce(jsonb_agg(jsonb_build_object('article_id', article_id, 'theorique', theo, 'compte', compte, 'ecart', ecart,
          'valeur_centimes', valeur, 'sans_cout', sans_cout, 'par_depot', par_depot)), '[]'),
      'nb_lignes', (select count(*) from stock_comptage_ligne where comptage_id = p_id and quantite_comptee is not null),
      'pertes_unites', coalesce(sum(case when not v_initial and ecart < 0 then -ecart end), 0),
      'pertes_centimes', coalesce(sum(case when not v_initial and ecart < 0 then -valeur end), 0),
      'surplus_unites', coalesce(sum(case when not v_initial and ecart > 0 then ecart end), 0),
      'valeur_stock_initial_centimes', case when v_initial then coalesce(sum(valeur), 0) end)
      into v_bilan from x;
    update stock_comptage set statut = 'valide', est_initial = v_initial, valide_par = auth.uid(), valide_le = now(), bilan = v_bilan where id = p_id;
  else
    raise exception 'action_inconnue';
  end if;
  return jsonb_build_object('ok', true, 'statut', (select statut from stock_comptage where id = p_id));
end $$;

create or replace function public.stock_comptages(p_limite integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_niv text := stock_exiger('comptage'); adm boolean := (v_niv = 'admin');
begin
  return (select coalesce(jsonb_agg(
      (to_jsonb(c) - case when adm then '{}'::text[] else array['bilan'] end)
      || jsonb_build_object('nb_lignes', (select count(*) from stock_comptage_ligne l where l.comptage_id = c.id and l.quantite_comptee is not null),
         'pertes_unites', (c.bilan->>'pertes_unites')::numeric, 'surplus_unites', (c.bilan->>'surplus_unites')::numeric,
         'cree_par_email', (select email from auth.users u where u.id = c.cree_par),
         'valide_par_email', (select email from auth.users u where u.id = c.valide_par))
      order by c.cree_le desc), '[]')
    from (select * from stock_comptage order by cree_le desc limit p_limite) c);
end $$;

-- ─────────────────────────────────────────────────────────────── essai à blanc des sorties (lot 2, N'ÉCRIT RIEN)
-- Ce que les sorties automatiques depuis « sac fait » auraient produit sur la période : ménages de départ et
-- recouches avec linge ; sac fait = sortie certaine ; sinon (mission passée sans « sac fait ») = repli « à vérifier ».
-- Consommés : sortent du stock ; circulants (linge) : passent du dépôt à « Dans les logements ».
create or replace function public.stock_essai_sorties(p_du date default current_date - 30, p_au date default current_date - 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform stock_exiger('admin');
  with m as (
    select mm.id, mm.bien_id, mm.date_mission, mm.type_mission, mm.recouche_jeux, b.code, b.agence,
           coalesce(ms.sac_fait, false) sac_fait, ms.zone_sac,
           coalesce(case when mm.type_mission = 'recouche' then mm.vente_voyageurs::int end,
             (select r.guest_count from reservation r where r.bien_id = mm.bien_id and r.final_status = 'accepted'
                and case when mm.type_mission = 'recouche' then r.arrival_date <= mm.date_mission and r.departure_date > mm.date_mission
                         else r.arrival_date >= mm.date_mission end order by r.arrival_date limit 1)) voyageurs
      from mission_menage mm join bien b on b.id = mm.bien_id
      left join mission_sac ms on ms.mission_id = mm.id
     where mm.date_mission between p_du and p_au and mm.statut <> 'cancelled'
       and (mm.type_mission = 'checkout' or (mm.type_mission = 'recouche' and coalesce(mm.recouche_linge, true)))
  ), l as (
    select m.*, n.article_id, n.libelle, n.quantite, s.id sac_id
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

-- ─────────────────────────────────────────────────────────────── droits d'exécution
do $$ declare f text; begin
  foreach f in array array['stock_niveau()', 'stock_exiger(text)', 'stock_linge_en_place(text)', 'stock_etat()',
    'stock_mouvements(integer, uuid, uuid, text, date, date)', 'stock_mouvement_saisir(jsonb)', 'stock_mouvement_annuler(uuid, text)',
    'stock_article_enregistrer(jsonb)', 'stock_depot_enregistrer(jsonb)', 'stock_seuil_definir(uuid, uuid, numeric, numeric)',
    'stock_fournisseur_enregistrer(jsonb)', 'stock_libelle_relier(text, uuid, text)', 'stock_reception_enregistrer(jsonb)',
    'stock_reception_annuler(uuid, text)', 'stock_receptions(integer)', 'stock_comptage_ouvrir(text, uuid[])', 'stock_comptage_detail(uuid)',
    'stock_comptage_saisir(uuid, uuid, uuid, numeric, boolean, numeric, text)', 'stock_comptage_statut(uuid, text)', 'stock_comptages(integer)',
    'stock_essai_sorties(date, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────── dépôts + droits initiaux
insert into public.stock_depot (code, nom, type, role, zone, bien_id, codes_zone_sac, ordre, note) values
  ('MFC', 'Bureau MFC', 'physique', 'stock', 'cote_basque', (select id from public.bien where code = '01' limit 1), array['MFC'], 10,
   'Le bureau (bien 01 « MFC »).'),
  ('CAVE-ML', 'Cave ML (Mont Louis)', 'physique', 'stock', 'cote_basque', null, '{}', 20,
   'Cave de Mont Louis. Zone de sac correspondante dans les tâches à confirmer (« MM » ?).'),
  ('LOGEMENTS', 'Dans les logements', 'virtuel', 'logements', 'cote_basque', null, '{}', 80,
   'Linge en place dans les logements (lits faits, salles de bain), propre ou en service. Emplacement virtuel.'),
  ('SALE', 'Au sale', 'virtuel', 'sale', 'cote_basque', null, '{}', 90,
   'Linge sale en attente de lavage (sacs rapportés, blanchisserie). Emplacement virtuel.')
on conflict (code) do nothing;

insert into public.stock_fournisseur (nom, note) values ('Resuinsa', 'Fournisseur de linge (achats 2022-2023, ancien inventaire).')
on conflict (nom) do nothing;

-- Oïhan (2 comptes) : stock_admin ; Laura (2 comptes) et Léa : stock (lecture + comptage, sans coûts)
insert into public.ph_droit (auth_user_id, droit, perimetre)
select u.id, 'stock_admin', 'tout' from auth.users u where lower(u.email) in ('oihan@destinationcotebasque.com', 'oihan64@gmail.com')
on conflict (auth_user_id, droit) do nothing;
insert into public.ph_droit (auth_user_id, droit, perimetre)
select u.id, 'stock', 'tout' from auth.users u
 where lower(u.email) in ('oihan@destinationcotebasque.com', 'oihan64@gmail.com', 'laura@destinationcotebasque.com', 'lauracoursan@hotmail.fr', 'lea@destinationbordeaux.com')
on conflict (auth_user_id, droit) do nothing;
