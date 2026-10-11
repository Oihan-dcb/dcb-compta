-- 406 — Fiche bien PowerHouse : 💶 Tarification (RÉGLAGES) + 🌐 Vente directe (11/10/2026, maquette v3 validée
-- par Oïhan : « ok très bien »).
--
-- 1. bien_tarification.canal ouvert aux canaux ajoutés à la main (Google, Vrbo…) : la majoration par
--    distributeur se stocke en ligne cle='majoration' × canal (texte = libellé d'un canal ajouté).
-- 2. bien_frais : les frais du séjour configurables UN PAR UN (actif, € ou %, unité par séjour / nuit /
--    voyageur / voyageur et nuit / animal, valeur commune ou par canal, canaux concernés, condition « séjours
--    de N nuits au plus », frais personnalisés). Lu par PowerHouse api/_resaManuelle.calculerMontant (résas
--    manuelles, devis, futur widget) ; un frais système absent de bien_frais garde l'ancien calcul (fiche
--    bien_tarification puis dernière résa directe).
--    Reprise : les valeurs RETENUES aujourd'hui dans bien_tarification (saisie > Hospitable > historique des
--    résas) deviennent les frais du bien, avec leur origine ; bien_tarification n'est PAS modifiée (historique
--    conservé, toujours rafraîchi chaque nuit et affiché comme repère).
-- 3. bien_vente_directe : réglages de la vente directe par bien (activation, contrôle « meilleur prix »,
--    paiement par défaut du widget, fenêtre, codes promo, contenu du widget FR/EN/ES). Les réglages déjà
--    portés par bien_tarification (réservation instantanée, séjour minimum, fenêtre en mois, caution,
--    annulation) y restent : pas de doublon.
-- 4. vente_directe_parametres : hypothèses de la comparaison des canaux, PAR AGENCE, À CONFIRMER (coût Stripe
--    ≈ 1,5 % + 0,25 €, frais de gestion Booking 5 % → DCB ?).
-- 5. commission_plateformes(bien) : commission Airbnb / Booking MESURÉE sur les résas des 12 derniers mois
--    (host fees ÷ hébergement + frais voyageur), du bien puis de l'agence.
-- Appliquée en 406a (canaux, bien_frais), 406b (reprise), 406c (vente directe, paramètres, commissions) puis 406d
-- (reprise refaite : la 1re version généralisait à tous les canaux une valeur vue sur un seul → ménage compté deux
-- fois en Direct sur 7 biens, ex. IBANETA cleaning fee Booking 95 € + community fee Direct 95 €).
-- Journal : tout changement de bien_frais / bien_vente_directe va dans bien_tarification_journal.

-- ═══ 1. Canaux ajoutables ════════════════════════════════════════════════════════════════════════
alter table public.bien_tarification drop constraint if exists bien_tarification_canal_check;
alter table public.bien_tarification add constraint bien_tarification_canal_check
  check (canal in ('tous', 'airbnb', 'booking', 'direct') or canal ~ '^[a-z][a-z0-9_]{1,23}$');

-- ═══ 2. Frais configurables ══════════════════════════════════════════════════════════════════════
create table if not exists public.bien_frais (
  id            uuid primary key default gen_random_uuid(),
  bien_id       uuid not null references public.bien(id) on delete cascade,
  cle           text not null check (cle ~ '^[a-z][a-z0-9_]{1,40}$'),  -- menage_community, gestion… ou perso_xxxx
  libelle       text not null check (length(btrim(libelle)) between 1 and 80),
  -- categorie → ligne de la résa (et libellé Hospitable / compta) : menage → Community fee (MEN/FMEN),
  -- gestion → Management fee (COM), service → Resort fee (COM), linge → Linen fee, animaux → Pet fee,
  -- autre → frais libre (other_fees, libellé du frais).
  categorie     text not null check (categorie in ('menage', 'gestion', 'service', 'linge', 'animaux', 'autre')),
  actif         boolean not null default true,
  type_valeur   text not null check (type_valeur in ('eur', 'pct')),             -- eur = centimes ; pct = % de l'hébergement
  unite         text not null default 'par_sejour'
                check (unite in ('par_sejour', 'par_nuit', 'par_voyageur', 'par_voyageur_nuit', 'par_animal')),
  valeur        numeric check (valeur is null or valeur >= 0),                     -- valeur commune (tous canaux)
  valeurs_canal jsonb,                                                             -- {"airbnb": 0, "direct": 10} : prime sur la valeur commune
  canaux        text[],                                                            -- null = tous les canaux
  max_nuits     int check (max_nuits is null or max_nuits between 1 and 365),     -- ex. ménage courts séjours : 2
  ordre         int not null default 100,
  origine       text,                                                              -- d'où vient la valeur (reprise, saisie)
  maj_le        timestamptz not null default now(),
  maj_par       text,
  unique (bien_id, cle),
  check (valeurs_canal is null or jsonb_typeof(valeurs_canal) = 'object')
);
create index if not exists idx_bien_frais_bien on public.bien_frais(bien_id);
comment on table public.bien_frais is
  'Frais du séjour d''un bien, configurables un par un (406). Lu par PowerHouse _resaManuelle.calculerMontant. Un frais système absent = ancien calcul (bien_tarification puis dernière résa directe).';

alter table public.bien_frais enable row level security;
drop policy if exists bien_frais_staff on public.bien_frais;
create policy bien_frais_staff on public.bien_frais for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.bien_frais from anon;

create or replace function public.trg_bien_frais_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_par text := coalesce(auth.email(), 'système');
  f_old jsonb; f_new jsonb;
begin
  if tg_op <> 'INSERT' then f_old := to_jsonb(old) - 'id' - 'bien_id' - 'maj_le' - 'maj_par'; end if;
  if tg_op <> 'DELETE' then f_new := to_jsonb(new) - 'id' - 'bien_id' - 'maj_le' - 'maj_par'; end if;
  if tg_op = 'INSERT' then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, apres, par) values (new.bien_id, 'frais:' || new.cle, 'tous', 'ajout', f_new, coalesce(new.maj_par, v_par));
  elsif tg_op = 'UPDATE' then
    if f_old - 'origine' is distinct from f_new - 'origine' then
      insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par) values (new.bien_id, 'frais:' || new.cle, 'tous', 'modification', f_old, f_new, coalesce(new.maj_par, v_par));
    end if;
  else
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, par) values (old.bien_id, 'frais:' || old.cle, 'tous', 'suppression', f_old, v_par);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_bien_frais_journal on public.bien_frais;
create trigger trg_bien_frais_journal after insert or update or delete on public.bien_frais
  for each row execute function public.trg_bien_frais_journal();

-- Reprise des valeurs retenues (saisie > Hospitable > historique), une ligne par bien × frais connu.
with map(src, cle, libelle, categorie, type_valeur, ordre) as (values
  ('frais_community', 'menage_community', 'Ménage (community fee)', 'menage',  'eur', 10),
  ('frais_menage',    'menage_cleaning',  'Ménage (cleaning fee)',  'menage',  'eur', 20),
  ('gestion_pct',     'gestion',          'Frais de gestion',       'gestion', 'pct', 30),
  ('frais_linge',     'linge',            'Linge',                  'linge',   'eur', 40),
  ('frais_resort',    'service',          'Frais de service',       'service', 'pct', 50),
  ('frais_animaux',   'animaux',          'Animaux',                'animaux', 'eur', 60)
),
ret as (
  select distinct on (t.bien_id, t.cle, t.canal) t.bien_id, t.cle, t.canal, t.valeur, t.source, t.detail
  from bien_tarification t
  where t.cle in (select src from map) and t.canal in ('tous', 'airbnb', 'booking', 'direct')
  order by t.bien_id, t.cle, t.canal, case t.source when 'powerhouse' then 0 when 'hospitable' then 1 else 2 end
),
-- Même règle que l'ancien calcul : le ménage = community fee, la cleaning fee seulement à défaut. Une cleaning
-- fee d'un canal où la community fee est connue et positive n'est pas reprise (sinon ménage compté deux fois :
-- ex. 416 Direct, cleaning 81 € en février puis community 97 € depuis).
ret2 as (
  select r.* from ret r
  where not (r.cle = 'frais_menage' and exists (select 1 from ret c where c.bien_id = r.bien_id and c.cle = 'frais_community'
                                                and c.canal in (r.canal, 'tous') and coalesce(c.valeur, 0) > 0))
),
agg as (
  select bien_id, cle,
         max(valeur) filter (where canal = 'tous') as v_tous,
         jsonb_object_agg(canal, valeur) filter (where canal <> 'tous' and valeur is not null) as vc,
         bool_or(coalesce(valeur, 0) > 0) as positif,
         string_agg(case canal when 'tous' then 'tous canaux' when 'direct' then 'Direct' when 'airbnb' then 'Airbnb' else 'Booking' end
                    || ' ' || case source when 'powerhouse' then 'saisi' when 'hospitable' then 'Hospitable' else coalesce(detail, 'historique') end,
                    ' ; ' order by canal) as det
  from ret2 group by bien_id, cle
)
insert into public.bien_frais (bien_id, cle, libelle, categorie, actif, type_valeur, unite, valeur, valeurs_canal, ordre, origine, maj_par)
select a.bien_id, m.cle, m.libelle, m.categorie, a.positif, m.type_valeur, 'par_sejour',
       -- Valeur commune seulement si la fiche en a une « tous canaux » ; sinon une valeur PAR CANAL, telle qu'observée
       -- (pas de généralisation : une cleaning fee vue sur Booking seulement ne doit pas s'ajouter au ménage Direct).
       -- Canal sans valeur : le moteur reprend la valeur d'un autre canal pour le ménage (comme l'ancien calcul).
       a.v_tous,
       a.vc,
       m.ordre,
       left('Repris le 11/10/2026 des valeurs connues (' || a.det || ') — à vérifier', 500),
       'migration 406 (reprise de la fiche)'
from agg a join map m on m.src = a.cle
on conflict (bien_id, cle) do nothing;

-- ═══ 3. Vente directe par bien ═══════════════════════════════════════════════════════════════════
create table if not exists public.bien_vente_directe (
  bien_id              uuid primary key references public.bien(id) on delete cascade,
  active               boolean not null default false,
  meilleur_prix        text not null default 'bloquant' check (meilleur_prix in ('bloquant', 'alerte')),
  paiement_defaut      text not null default 'acompte_50' check (paiement_defaut in ('acompte_50', 'totalite')),
  seuil_totalite_jours int not null default 30 check (seuil_totalite_jours between 0 and 365),
  fenetre_min_jours    int not null default 1 check (fenetre_min_jours between 0 and 60),
  codes_promo          jsonb not null default '[]'::jsonb check (jsonb_typeof(codes_promo) = 'array'),
  contenu              jsonb not null default '{}'::jsonb check (jsonb_typeof(contenu) = 'object'),
  maj_le               timestamptz not null default now(),
  maj_par              text
);
comment on table public.bien_vente_directe is
  'Vente directe d''un bien (406) : activation, contrôle meilleur prix vs Airbnb, paiement par défaut du widget, fenêtre, codes promo, contenu du widget {titre:{fr,en,es}, description:{…}, photos:[url], points_forts:{fr,en,es}}. Instantané / séjour min / fenêtre en mois / caution / annulation : bien_tarification (canal direct).';
alter table public.bien_vente_directe enable row level security;
drop policy if exists bien_vente_directe_staff on public.bien_vente_directe;
create policy bien_vente_directe_staff on public.bien_vente_directe for all to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
revoke all on public.bien_vente_directe from anon;

create or replace function public.trg_bien_vente_directe_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_par text := coalesce(auth.email(), 'système');
  f_old jsonb; f_new jsonb;
begin
  if tg_op <> 'INSERT' then f_old := to_jsonb(old) - 'bien_id' - 'maj_le' - 'maj_par'; end if;
  if tg_op <> 'DELETE' then f_new := to_jsonb(new) - 'bien_id' - 'maj_le' - 'maj_par'; end if;
  if tg_op = 'INSERT' then
    insert into bien_tarification_journal (bien_id, cle, canal, operation, apres, par) values (new.bien_id, 'vente_directe', 'direct', 'ajout', f_new, coalesce(new.maj_par, v_par));
  elsif tg_op = 'UPDATE' then
    if f_old is distinct from f_new then
      insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, apres, par) values (new.bien_id, 'vente_directe', 'direct', 'modification', f_old, f_new, coalesce(new.maj_par, v_par));
    end if;
  else
    insert into bien_tarification_journal (bien_id, cle, canal, operation, avant, par) values (old.bien_id, 'vente_directe', 'direct', 'suppression', f_old, v_par);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_bien_vente_directe_journal on public.bien_vente_directe;
create trigger trg_bien_vente_directe_journal after insert or update or delete on public.bien_vente_directe
  for each row execute function public.trg_bien_vente_directe_journal();

-- ═══ 4. Hypothèses de la comparaison des canaux (par agence, À CONFIRMER) ═══════════════════════════
create table if not exists public.vente_directe_parametres (
  agence                   text primary key check (agence in ('dcb', 'lauian')),
  stripe_pct               numeric not null default 1.5 check (stripe_pct between 0 and 10),
  stripe_fixe_centimes     int not null default 25 check (stripe_fixe_centimes between 0 and 500),
  stripe_a_charge          text not null default 'dcb' check (stripe_a_charge in ('dcb', 'proprietaire')),
  booking_gestion_vers     text not null default 'dcb' check (booking_gestion_vers in ('dcb', 'proprietaire')),
  confirme                 boolean not null default false,
  maj_le                   timestamptz not null default now(),
  maj_par                  text
);
comment on table public.vente_directe_parametres is
  'Hypothèses de la comparaison Airbnb / Booking / Direct (406), À CONFIRMER par Oïhan : coût Stripe ≈ 1,5 % + 0,25 € (à la charge de DCB ?), frais de gestion Booking → DCB ? (la ventilation actuelle les laisse au propriétaire).';
insert into public.vente_directe_parametres (agence) values ('dcb'), ('lauian') on conflict do nothing;
alter table public.vente_directe_parametres enable row level security;
drop policy if exists vente_directe_parametres_staff on public.vente_directe_parametres;
create policy vente_directe_parametres_staff on public.vente_directe_parametres for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());
revoke all on public.vente_directe_parametres from anon;

-- ═══ 5. Commission plateformes mesurée ═══════════════════════════════════════════════════════════
create or replace function public.commission_plateformes(p_bien uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_agence text; v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not auth_user_is_staff() then raise exception 'réservé au staff'; end if;
  select agence into v_agence from bien where id = p_bien;
  with r as (
    select r.bien_id, r.platform,
           abs(coalesce((select sum((f->>'amount')::numeric) from jsonb_array_elements(coalesce(r.hospitable_raw->'financials'->'host'->'host_fees', '[]'::jsonb)) f), 0)) as hf,
           coalesce((r.hospitable_raw->'financials'->'guest'->'accommodation'->>'amount')::numeric, 0)
             + coalesce((select sum((f->>'amount')::numeric) from jsonb_array_elements(coalesce(r.hospitable_raw->'financials'->'guest'->'fees', '[]'::jsonb)) f), 0) as base
    from reservation r join bien b on b.id = r.bien_id
    where r.final_status = 'accepted' and not coalesce(r.owner_stay, false) and r.platform in ('airbnb', 'booking')
      and r.arrival_date between current_date - 365 and current_date and b.agence = v_agence and r.hospitable_raw is not null
  ), ok as (select * from r where base > 0 and hf > 0)
  select jsonb_object_agg(p.platform, jsonb_build_object(
           'bien_pct', (select round(100 * sum(hf) / sum(base), 2) from ok where platform = p.platform and bien_id = p_bien),
           'bien_nb', (select count(*) from ok where platform = p.platform and bien_id = p_bien),
           'agence_pct', (select round(100 * sum(hf) / sum(base), 2) from ok where platform = p.platform),
           'agence_nb', (select count(*) from ok where platform = p.platform)))
    into v from (values ('airbnb'), ('booking')) p(platform);
  return v;
end $$;
revoke all on function public.commission_plateformes(uuid) from public, anon;
grant execute on function public.commission_plateformes(uuid) to authenticated, service_role;
