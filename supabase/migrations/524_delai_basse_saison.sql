-- 524 — Délai de réservation en basse saison (22/10/2026, demande d'Oïhan pour VILLA AGERREA) :
-- « en basse saison les dispos se ferment à une semaine pour éviter de se mettre dans le jus en cas de location last minute ».
-- Autrement dit : en basse saison, pas d'arrivée à moins de N jours ; les nuits LIBRES des N prochains jours se ferment.
--
-- Hospitable a un réglage natif « advance_notice » (heures, une valeur par canal) mais il n'est PAS saisonnier et l'API v2
-- ne permet que de le LIRE (get-property-availability-settings, vérifié le 22/10/2026 : AGERREA advance_notice = 0). D'où :
--   · vente directe (dcb-planning api/_direct.js) : séjour refusé / nuits grisées ;
--   · Airbnb / Booking : cron quotidien PowerHouse (api/cron-delai-basse-saison.js) qui ferme dans Hospitable les nuits
--     LIBRES concernées, avec une note fixe, et ne rouvre QUE les nuits qu'il a lui-même fermées (journal ci-dessous).
--
-- 1. bien_delai_basse_saison : réglage par bien (désactivé par défaut). Basse saison stockée « MM-JJ » comme la saison de
--    vente directe (459) : début > fin = à cheval sur l'année. Exclusion (vacances de Noël) : nuits retirées de la basse
--    saison, null = aucune. Bornes = NUITS incluses.
-- 2. delai_basse_saison_reglage : interrupteur global Éteint / Essai / Actif (une ligne). Essai par défaut = calcule et
--    affiche « ce qui serait fermé », AUCUNE écriture Hospitable. Actif = clic d'Oïhan dans PowerHouse.
-- 3. delai_basse_saison_nuit : nuits fermées par PowerHouse dans Hospitable (seules celles-là peuvent être rouvertes).
-- 4. delai_basse_saison_passage : journal de chaque calcul (cron ou clic), y compris en Essai.
-- Lecture staff ; écriture serveur seulement (api/delai-basse-saison.js, bureau).

create table if not exists public.bien_delai_basse_saison (
  bien_id      uuid primary key references public.bien(id) on delete cascade,
  actif        boolean not null default false,
  jours        smallint not null default 7 check (jours between 1 and 60),
  basse_debut  text not null default '10-01' check (basse_debut ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  basse_fin    text not null default '03-31' check (basse_fin ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  exclu_debut  text default '12-20' check (exclu_debut is null or exclu_debut ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  exclu_fin    text default '01-03' check (exclu_fin is null or exclu_fin ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  maj_le       timestamptz not null default now(),
  maj_par      text,
  constraint bien_delai_basse_saison_exclu_paire check ((exclu_debut is null) = (exclu_fin is null)),
  constraint bien_delai_basse_saison_basse_distincte check (basse_debut <> basse_fin)
);
comment on table public.bien_delai_basse_saison is 'Délai de réservation en basse saison par bien (524) : pas d''arrivée à moins de N jours quand la nuit est en basse saison (MM-JJ, nuits incluses, exclusion = vacances de Noël).';

create table if not exists public.delai_basse_saison_reglage (
  id            smallint primary key default 1 check (id = 1),
  mode          text not null default 'essai' check (mode in ('eteint', 'essai', 'actif')),
  mode_maj_le   timestamptz,
  mode_maj_par  text
);
comment on table public.delai_basse_saison_reglage is 'Interrupteur global du délai basse saison (524) : eteint / essai (calcul seul, aucune écriture Hospitable) / actif.';
insert into public.delai_basse_saison_reglage (id) values (1) on conflict do nothing;

create table if not exists public.delai_basse_saison_nuit (
  id          uuid primary key default gen_random_uuid(),
  bien_id     uuid not null references public.bien(id) on delete cascade,
  nuit        date not null,
  statut      text not null default 'ferme' check (statut in ('ferme', 'rouvert', 'repris_main', 'passee')),
  ferme_le    timestamptz not null default now(),
  rouvert_le  timestamptz,
  detail      text,
  unique (bien_id, nuit)
);
comment on table public.delai_basse_saison_nuit is 'Nuits fermées dans Hospitable par le délai basse saison (524). ferme = encore fermée par PowerHouse ; rouvert = rouverte par PowerHouse ; repris_main = modifiée à la main depuis (plus jamais touchée) ; passee = nuit passée.';
create index if not exists delai_basse_saison_nuit_ferme on public.delai_basse_saison_nuit (bien_id) where statut = 'ferme';

create table if not exists public.delai_basse_saison_passage (
  id           uuid primary key default gen_random_uuid(),
  bien_id      uuid not null references public.bien(id) on delete cascade,
  le           timestamptz not null default now(),
  mode         text not null check (mode in ('eteint', 'essai', 'actif')),
  origine      text not null default 'cron' check (origine in ('cron', 'clic', 'interrupteur')),
  par          text,
  aujourdhui   date not null,
  a_fermer     date[] not null default '{}',
  a_rouvrir    date[] not null default '{}',
  fermees      date[] not null default '{}',
  rouvertes    date[] not null default '{}',
  laissees     jsonb not null default '[]'::jsonb,
  erreur       text
);
create index if not exists delai_basse_saison_passage_bien on public.delai_basse_saison_passage (bien_id, le desc);
comment on table public.delai_basse_saison_passage is 'Journal des calculs du délai basse saison (524), Essai compris : a_fermer / a_rouvrir = calcul ; fermees / rouvertes = écrit dans Hospitable (Actif seulement).';

alter table public.bien_delai_basse_saison enable row level security;
alter table public.delai_basse_saison_reglage enable row level security;
alter table public.delai_basse_saison_nuit enable row level security;
alter table public.delai_basse_saison_passage enable row level security;
drop policy if exists bien_delai_basse_saison_lecture_staff on public.bien_delai_basse_saison;
create policy bien_delai_basse_saison_lecture_staff on public.bien_delai_basse_saison for select to authenticated using (public.auth_user_is_staff());
drop policy if exists delai_basse_saison_reglage_lecture_staff on public.delai_basse_saison_reglage;
create policy delai_basse_saison_reglage_lecture_staff on public.delai_basse_saison_reglage for select to authenticated using (public.auth_user_is_staff());
drop policy if exists delai_basse_saison_nuit_lecture_staff on public.delai_basse_saison_nuit;
create policy delai_basse_saison_nuit_lecture_staff on public.delai_basse_saison_nuit for select to authenticated using (public.auth_user_is_staff());
drop policy if exists delai_basse_saison_passage_lecture_staff on public.delai_basse_saison_passage;
create policy delai_basse_saison_passage_lecture_staff on public.delai_basse_saison_passage for select to authenticated using (public.auth_user_is_staff());
revoke all on public.bien_delai_basse_saison, public.delai_basse_saison_reglage, public.delai_basse_saison_nuit, public.delai_basse_saison_passage from anon;

-- VILLA AGERREA (Villa Ahetze, proprio Grandvoinet) : 7 jours, activé (l'interrupteur global reste en Essai).
insert into public.bien_delai_basse_saison (bien_id, actif, jours, maj_par)
select id, true, 7, 'claude — demande Oïhan 22/10/2026' from public.bien where code = 'VILLA AGERREA'
on conflict (bien_id) do nothing;
