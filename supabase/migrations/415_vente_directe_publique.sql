-- 415_vente_directe_publique.sql — page publique « Réserver » + widgets de location (PowerHouse, 14/10/2026).
-- Tables lues/écrites UNIQUEMENT par les endpoints serveur (service_role) : RLS activée, lecture staff seulement,
-- aucune écriture par un client (pas de policy INSERT/UPDATE/DELETE), rien pour anon.
-- devis_option : origine 'web' (option courte créée par le site, SANS blocage Hospitable → blocage 'aucun').
-- devis_option_creer : paramètres optionnels en plus (rétro-compatible avec le Calendrier) + plafond d'options web
-- simultanées par bien, vérifié sous le même verrou consultatif que les conflits.

create table if not exists public.direct_widget (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default encode(gen_random_bytes(9), 'hex') check (public_id ~ '^[a-f0-9]{18}$'),
  agence text not null check (agence in ('dcb','lauian')),
  nom text not null check (char_length(nom) between 1 and 80),
  type text not null check (type in ('bouton','calendrier','recherche')),
  biens uuid[] not null default '{}',
  langue text not null default 'auto' check (langue in ('auto','fr','en','es')),
  apparence jsonb not null default '{}'::jsonb check (jsonb_typeof(apparence) = 'object'),
  domaines text[] not null default '{}' check (cardinality(domaines) <= 20),
  ouverture text not null default 'nouvel_onglet' check (ouverture in ('nouvel_onglet','meme_onglet')),
  actif boolean not null default false,
  cree_par text, cree_le timestamptz not null default now(),
  maj_par text, maj_le timestamptz not null default now()
);

create table if not exists public.direct_evenement (
  id bigint generated always as identity primary key,
  widget_id uuid references public.direct_widget(id) on delete set null,
  bien_id uuid references public.bien(id) on delete set null,
  type text not null check (type in ('vue','devis','reservation','demande','refus','abus')),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{24}$'),
  detail jsonb,
  cree_le timestamptz not null default now()
);
create index if not exists direct_evenement_cree_le_idx on public.direct_evenement (cree_le);
create index if not exists direct_evenement_widget_idx on public.direct_evenement (widget_id, cree_le);
create index if not exists direct_evenement_bien_idx on public.direct_evenement (bien_id, cree_le);

create table if not exists public.direct_demande (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete restrict,
  widget_id uuid references public.direct_widget(id) on delete set null,
  arrivee date not null, depart date not null check (depart > arrivee),
  adultes int not null check (adultes between 1 and 50),
  enfants int not null default 0 check (enfants between 0 and 30),
  animaux int not null default 0 check (animaux between 0 and 5),
  voyageur_prenom text not null check (char_length(voyageur_prenom) between 1 and 60),
  voyageur_nom text not null check (char_length(voyageur_nom) between 1 and 60),
  voyageur_email text not null check (char_length(voyageur_email) <= 254),
  voyageur_telephone text check (char_length(voyageur_telephone) <= 20),
  langue text not null default 'fr' check (langue in ('fr','en','es')),
  message text check (char_length(message) <= 1000),
  lignes jsonb not null default '[]'::jsonb,
  total_centimes int not null check (total_centimes >= 0),
  promo jsonb, motif_demande text,
  consentement jsonb not null,
  statut text not null default 'nouvelle' check (statut in ('nouvelle','acceptee','refusee','expiree')),
  devis_id uuid references public.devis_option(id) on delete set null,
  traite_par text, traite_le timestamptz, note_bureau text check (char_length(note_bureau) <= 500),
  ip_hash text,
  cree_le timestamptz not null default now()
);
create index if not exists direct_demande_statut_idx on public.direct_demande (statut, cree_le desc);
create index if not exists direct_demande_bien_idx on public.direct_demande (bien_id, arrivee);

alter table public.devis_option
  add column if not exists origine text not null default 'bureau',
  add column if not exists widget_id uuid references public.direct_widget(id) on delete set null,
  add column if not exists consentement jsonb,
  add column if not exists promo jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'devis_option_origine_check') then
    alter table public.devis_option add constraint devis_option_origine_check check (origine in ('bureau','web'));
  end if;
end $$;
alter table public.devis_option drop constraint if exists devis_option_blocage_check;
alter table public.devis_option add constraint devis_option_blocage_check
  check (blocage = any (array['a_poser','pose','echec','leve','leve_partiel','aucun']));
create index if not exists devis_option_web_actives_idx on public.devis_option (bien_id, option_jusqu_au) where origine = 'web' and statut = 'option';

-- RLS : lecture staff (périmètre secteur pour ce qui touche un bien), aucune écriture client.
alter table public.direct_widget enable row level security;
alter table public.direct_evenement enable row level security;
alter table public.direct_demande enable row level security;
revoke all on public.direct_widget, public.direct_evenement, public.direct_demande from anon;
revoke insert, update, delete, truncate on public.direct_widget, public.direct_evenement, public.direct_demande from authenticated;
grant select on public.direct_widget, public.direct_evenement, public.direct_demande to authenticated;
drop policy if exists direct_widget_lecture_staff on public.direct_widget;
create policy direct_widget_lecture_staff on public.direct_widget for select to authenticated using (auth_user_is_staff());
drop policy if exists direct_evenement_lecture_staff on public.direct_evenement;
create policy direct_evenement_lecture_staff on public.direct_evenement for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id is null or bien_id in (select my_scoped_bien_ids())));
drop policy if exists direct_demande_lecture_staff on public.direct_demande;
create policy direct_demande_lecture_staff on public.direct_demande for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

-- devis_option_creer : mêmes contrôles + champs optionnels du site. Signature inchangée (p jsonb).
create or replace function public.devis_option_creer(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_bien uuid := (p->>'bien_id')::uuid; v_conf jsonb; v_row devis_option; v_origine text := coalesce(nullif(p->>'origine', ''), 'bureau');
begin
  perform pg_advisory_xact_lock(hashtextextended('calendrier:' || v_bien::text, 0));
  v_conf := calendrier_creneau_conflits(v_bien, (p->>'arrivee')::date, (p->>'depart')::date);
  if jsonb_array_length(v_conf) > 0 then return jsonb_build_object('ok', false, 'conflits', v_conf); end if;
  if v_origine = 'web' and (select count(*) from devis_option d where d.bien_id = v_bien and d.origine = 'web' and d.statut = 'option' and d.option_jusqu_au > now())
       >= coalesce((p->>'max_options_web')::int, 3) then
    return jsonb_build_object('ok', false, 'code', 'trop_options', 'conflits', '[]'::jsonb);
  end if;
  insert into devis_option (bien_id, arrivee, depart, adultes, enfants, voyageur_prenom, voyageur_nom, voyageur_email,
    voyageur_telephone, langue, lignes, total_centimes, option_jusqu_au, note_blocage, cree_par, cree_par_label,
    origine, widget_id, consentement, promo, paiement, blocage, jetons_jours)
  values (v_bien, (p->>'arrivee')::date, (p->>'depart')::date, coalesce((p->>'adultes')::int, 1), coalesce((p->>'enfants')::int, 0),
    p->>'voyageur_prenom', p->>'voyageur_nom', nullif(p->>'voyageur_email', ''), nullif(p->>'voyageur_telephone', ''),
    coalesce(nullif(p->>'langue', ''), 'fr'), coalesce(p->'lignes', '[]'::jsonb), coalesce((p->>'total_centimes')::int, 0),
    (p->>'option_jusqu_au')::timestamptz, p->>'note_blocage', nullif(p->>'cree_par', '')::uuid, p->>'cree_par_label',
    v_origine, nullif(p->>'widget_id', '')::uuid, p->'consentement', p->'promo', p->'paiement',
    coalesce(nullif(p->>'blocage', ''), 'a_poser'), p->'jetons_jours')
  returning * into v_row;
  return jsonb_build_object('ok', true, 'devis', to_jsonb(v_row));
end $function$;
revoke all on function public.devis_option_creer(jsonb) from public, anon, authenticated;
grant execute on function public.devis_option_creer(jsonb) to service_role;
