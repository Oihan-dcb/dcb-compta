-- 411 — Fiche bien PowerHouse : lots 2 (🔑 Accès & arrivée) et 3 (📚 Savoir) + tri des faits appris
-- (14/10/2026, décisions d'Oïhan sur ~/Downloads/Proposition_fiche_bien_PowerHouse_2026-10-11.md).
--
--   • bien_savoir : UNE base de savoir par bien, rédigée en FRANÇAIS dans PowerHouse. Chaque élément dit à qui
--     il sert (voyageur / IA / AE), sa période de validité (saison récurrente JJ/MM → JJ/MM, ou date de fin),
--     sa source et sa date. La version anglaise envoyée au Knowledge Hub Hospitable est traduite à la
--     SAUVEGARDE (Haiku, cache par empreinte du texte FR) — jamais en lecture. Aucun code ni mot de passe :
--     ils restent dans les custom codes Hospitable (bien_custom_code). Écritures : API PowerHouse
--     (api/bien-savoir.js, service role) ; lecture directe possible pour le staff de son périmètre.
--   • bien_savoir_journal : qui a changé quoi (trigger).
--   • ga_mined_fact : tri automatique des faits appris (statut « ecarte_auto » + motif + référence), RÉVERSIBLE
--     et journalisé (ga_mined_fact_journal, par lot).
--   • bien_code_rotation / bien_custom_code_journal / bien_code_consultation : alerte « code mensuel pas changé »,
--     date de chaque changement de code vu par la synchro (SANS la valeur), trace de qui a affiché un code.
--   • ga_agency_config.savoir_ia : 'parallele' (défaut : l'IA garde l'ancien contexte, le nouveau est construit
--     et comparé à chaque message, sans appel IA en plus) → 'actif' (l'IA lit bien_savoir) après comparaison.
--   • ga_savoir_comparaison : journal de cette comparaison.
--   • Consignes AE (onglet Terrain, plus tard) : bien_particularite.origine / savoir_id + bien_consigne_suggestion
--     (suggestions des AE depuis Ma journée, validées par le bureau). Modèle seulement, aucun écran.

-- ── 1. Savoir ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.bien_savoir (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,
  agence text,
  categorie text not null default 'autre' check (categorie in (
    'arrivee','depart','acces_parking','internet','equipements','piscine_exterieur','menage_linge','bagages',
    'services_payants','regles','securite_urgence','quartier_transports','reservation_paiement','autre')),
  titre text,
  contenu_fr text not null check (length(btrim(contenu_fr)) > 0),
  public text[] not null default array['voyageur','ia']::text[]
    check (public <@ array['voyageur','ia','ae']::text[] and cardinality(public) > 0),
  -- Période de validité : saison récurrente (« 05-15 » → « 09-15 », peut chevaucher le 31/12) et/ou date de fin.
  periode_debut text check (periode_debut is null or periode_debut ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  periode_fin text check (periode_fin is null or periode_fin ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  valable_jusqu_au date,
  statut text not null default 'actif' check (statut in ('actif','a_relire','archive')),
  motif_relecture text,                      -- pourquoi « à relire » (contradiction, doublon possible…)
  source text not null default 'powerhouse' check (source in ('hub','fiche_acces','fait_appris','powerhouse','particularite')),
  sources jsonb not null default '[]'::jsonb, -- [{type:'hub',id,topic,maj}, {type:'fait',id}, {type:'fiche_acces',champ}]
  source_date date,                          -- date de la donnée d'origine (MAJ Hub, date du fait…)
  contient_acces boolean not null default false, -- l'original portait un code / Wi-Fi : jamais poussé vers le Hub
  contenu_en text,                           -- traduction pour le Knowledge Hub (à la sauvegarde)
  en_empreinte text,                         -- md5 du contenu_fr traduit (cache : pas de retraduction si inchangé)
  hub_item_id bigint,                        -- élément Knowledge Hub correspondant
  hub_topic text,
  hub_pousse_at timestamptz,
  hub_pousse_empreinte text,                 -- md5 du contenu_en poussé (→ « à pousser » si différent)
  ordre integer not null default 0,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bien_savoir_bien_idx on public.bien_savoir (bien_id, statut, categorie);
create unique index if not exists bien_savoir_hub_item_uidx on public.bien_savoir (bien_id, hub_item_id) where hub_item_id is not null and statut <> 'archive';
alter table public.bien_savoir enable row level security;
drop policy if exists bien_savoir_lecture on public.bien_savoir;
create policy bien_savoir_lecture on public.bien_savoir for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

create table if not exists public.bien_savoir_journal (
  id bigserial primary key,
  savoir_id uuid not null,
  bien_id uuid,
  action text not null,                      -- creation / modification / archivage / hub
  avant jsonb, apres jsonb,
  par uuid,
  at timestamptz not null default now()
);
create index if not exists bien_savoir_journal_idx on public.bien_savoir_journal (bien_id, at desc);
alter table public.bien_savoir_journal enable row level security;
drop policy if exists bien_savoir_journal_lecture on public.bien_savoir_journal;
create policy bien_savoir_journal_lecture on public.bien_savoir_journal for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));

create or replace function public.bien_savoir_journaliser() returns trigger language plpgsql as $$
declare
  champs text[] := array['categorie','titre','contenu_fr','public','periode_debut','periode_fin','valable_jusqu_au','statut','motif_relecture','hub_item_id','hub_pousse_at'];
  a jsonb; n jsonb; av jsonb := '{}'; ap jsonb := '{}'; k text;
begin
  if tg_op = 'INSERT' then
    insert into public.bien_savoir_journal (savoir_id, bien_id, action, apres, par)
    values (new.id, new.bien_id, 'creation', jsonb_build_object('categorie', new.categorie, 'contenu_fr', new.contenu_fr, 'source', new.source, 'statut', new.statut), new.created_by);
    return new;
  end if;
  a := to_jsonb(old); n := to_jsonb(new);
  foreach k in array champs loop
    if a->k is distinct from n->k then av := av || jsonb_build_object(k, a->k); ap := ap || jsonb_build_object(k, n->k); end if;
  end loop;
  if ap <> '{}'::jsonb then
    insert into public.bien_savoir_journal (savoir_id, bien_id, action, avant, apres, par)
    values (new.id, new.bien_id,
      case when new.statut = 'archive' and old.statut <> 'archive' then 'archivage'
           when ap ? 'hub_pousse_at' and (ap - 'hub_pousse_at' - 'hub_item_id') = '{}'::jsonb then 'hub'
           else 'modification' end,
      av, ap, new.updated_by);
  end if;
  return new;
end $$;
drop trigger if exists bien_savoir_journal_trg on public.bien_savoir;
create trigger bien_savoir_journal_trg after insert or update on public.bien_savoir
  for each row execute function public.bien_savoir_journaliser();

-- ── 2. Tri des faits appris (ga_mined_fact) ───────────────────────────────────────────────────────────────
alter table public.ga_mined_fact drop constraint if exists ga_mined_fact_status_check;
alter table public.ga_mined_fact add constraint ga_mined_fact_status_check
  check (status in ('candidate','approved','rejected','activated','ecarte_auto'));
alter table public.ga_mined_fact
  add column if not exists tri text check (tri is null or tri in ('doublon','secret','obsolete','concordant','a_trancher','nouveau')),
  add column if not exists tri_motif text,
  add column if not exists tri_ref text,         -- élément de référence (« Hub Parking MAJ 26/07/2026 », id d'un fait…)
  add column if not exists tri_at timestamptz,
  add column if not exists tri_lot text,
  add column if not exists fact_corrige text,    -- texte corrigé par le bureau à la relecture
  add column if not exists savoir_id uuid;       -- élément Savoir créé quand le fait est gardé
create index if not exists ga_mined_fact_tri_idx on public.ga_mined_fact (status, tri);

create table if not exists public.ga_mined_fact_journal (
  id bigserial primary key,
  fact_id uuid not null,
  lot text,
  ancien_status text, nouveau_status text,
  ancien_tri text, nouveau_tri text,
  motif text,
  par text not null default 'auto',          -- 'auto' (tri automatique) ou uuid du relecteur
  at timestamptz not null default now()
);
create index if not exists ga_mined_fact_journal_idx on public.ga_mined_fact_journal (fact_id, at desc);
create index if not exists ga_mined_fact_journal_lot_idx on public.ga_mined_fact_journal (lot);
alter table public.ga_mined_fact_journal enable row level security;

-- ── 3. Codes : rotation mensuelle, date des changements, consultations ────────────────────────────────────
create table if not exists public.bien_code_rotation (
  bien_id uuid not null references public.bien(id) on delete cascade,
  code_key text not null,
  periodicite_jours integer not null default 31 check (periodicite_jours between 1 and 400),
  note text,
  created_at timestamptz not null default now(),
  primary key (bien_id, code_key)
);
alter table public.bien_code_rotation enable row level security;
drop policy if exists bien_code_rotation_lecture on public.bien_code_rotation;
create policy bien_code_rotation_lecture on public.bien_code_rotation for select to authenticated
  using (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
-- Amorçage : les codes principaux dont le texte nomme un mois (« octobre - …, novembre - … ») changent chaque
-- mois (résidence Victoria : 416, 602, 408P, 506P, ALAIA au 14/10/2026). Repéré sur la donnée, pas en dur.
insert into public.bien_code_rotation (bien_id, code_key, periodicite_jours, note)
select c.bien_id, c.code_key, 31, 'Code mensuel (repéré le 14/10/2026 : le texte du code nomme le mois)'
from public.bien_custom_code c
where c.code_key = 'codeprincipal'
  and c.value ~* '(janvier|f[ée]vrier|mars|avril|\mmai\M|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)'
on conflict do nothing;

-- Journal des changements de code vus par la synchro quotidienne (sync-custom-codes) — SANS la valeur.
create table if not exists public.bien_custom_code_journal (
  id bigserial primary key,
  bien_id uuid not null,
  code_key text not null,
  action text not null,                      -- ajout / modification / suppression
  longueur integer,
  at timestamptz not null default now()
);
create index if not exists bien_custom_code_journal_idx on public.bien_custom_code_journal (bien_id, code_key, at desc);
alter table public.bien_custom_code_journal enable row level security;
create or replace function public.bien_custom_code_journaliser() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.bien_custom_code_journal (bien_id, code_key, action, longueur) values (new.bien_id, new.code_key, 'ajout', length(new.value));
  elsif tg_op = 'UPDATE' then
    if new.value is distinct from old.value then
      insert into public.bien_custom_code_journal (bien_id, code_key, action, longueur) values (new.bien_id, new.code_key, 'modification', length(new.value));
    end if;
  else
    insert into public.bien_custom_code_journal (bien_id, code_key, action, longueur) values (old.bien_id, old.code_key, 'suppression', null);
    return old;
  end if;
  return new;
end $$;
drop trigger if exists bien_custom_code_journal_trg on public.bien_custom_code;
create trigger bien_custom_code_journal_trg after insert or update or delete on public.bien_custom_code
  for each row execute function public.bien_custom_code_journaliser();

create table if not exists public.bien_code_consultation (
  id bigserial primary key,
  bien_id uuid not null,
  code_key text not null,
  par uuid,
  at timestamptz not null default now()
);
create index if not exists bien_code_consultation_idx on public.bien_code_consultation (bien_id, at desc);
alter table public.bien_code_consultation enable row level security;

-- ── 4. IA voyageurs : bascule vers le Savoir après comparaison ────────────────────────────────────────────
alter table public.ga_agency_config
  add column if not exists savoir_ia text not null default 'parallele' check (savoir_ia in ('off','parallele','actif'));
create table if not exists public.ga_savoir_comparaison (
  id bigserial primary key,
  job_id uuid,
  bien_id uuid,
  bien_code text,
  mode text not null,                        -- mode au moment du message (parallele / actif)
  ancien_nb integer, ancien_car integer,     -- éléments / caractères du contexte « logement » ancien (Hub + extraits)
  nouveau_nb integer, nouveau_car integer,   -- idem depuis bien_savoir
  hub_couverts integer, hub_total integer,   -- éléments du Hub repris (ou écartés avec motif) dans le Savoir
  manquants jsonb,                           -- extraits de l'ancien contexte sans équivalent dans le Savoir
  at timestamptz not null default now()
);
create index if not exists ga_savoir_comparaison_idx on public.ga_savoir_comparaison (bien_id, at desc);
alter table public.ga_savoir_comparaison enable row level security;

-- ── 5. Consignes AE (onglet Terrain, plus tard) : modèle seulement ────────────────────────────────────────
alter table public.bien_particularite
  add column if not exists origine text not null default 'bureau' check (origine in ('bureau','savoir','suggestion_ae')),
  add column if not exists savoir_id uuid references public.bien_savoir(id) on delete set null;
create table if not exists public.bien_consigne_suggestion (
  id uuid primary key default gen_random_uuid(),
  bien_id uuid not null references public.bien(id) on delete cascade,
  ae_id uuid,                                -- auto_entrepreneur.id de l'AE qui propose (Ma journée)
  mission_id uuid,
  texte text not null check (length(btrim(texte)) > 0),
  medias jsonb not null default '[]'::jsonb,
  statut text not null default 'proposee' check (statut in ('proposee','validee','refusee')),
  particularite_id uuid references public.bien_particularite(id) on delete set null, -- fiche publiée si validée
  traite_par uuid, traite_at timestamptz, motif_refus text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists bien_consigne_suggestion_idx on public.bien_consigne_suggestion (bien_id, statut);
alter table public.bien_consigne_suggestion enable row level security;
drop policy if exists bien_consigne_suggestion_lecture on public.bien_consigne_suggestion;
create policy bien_consigne_suggestion_lecture on public.bien_consigne_suggestion for select to authenticated
  using (created_by = auth.uid() or (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids()))));
drop policy if exists bien_consigne_suggestion_ajout on public.bien_consigne_suggestion;
create policy bien_consigne_suggestion_ajout on public.bien_consigne_suggestion for insert to authenticated
  with check (created_by = auth.uid() and statut = 'proposee' and (auth_user_is_internal() or auth_user_is_staff()));
drop policy if exists bien_consigne_suggestion_traitement on public.bien_consigne_suggestion;
create policy bien_consigne_suggestion_traitement on public.bien_consigne_suggestion for update to authenticated
  using (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  with check (auth_user_peut_editer_fiches() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())));
