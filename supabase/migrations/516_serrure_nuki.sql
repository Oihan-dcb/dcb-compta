-- 516 — Serrures connectées Nuki (20/10/2026, demande d'Oïhan : GASQ et PATXI, serrure Nuki SANS clavier).
--
-- Code PRÉPARÉ, DÉSACTIVÉ : tant que la variable Vercel NUKI_ACTIF ≠ « actif », rien n'appelle Nuki (api/_nuki.js) ;
-- NUKI_ACTIF=simule = réponses simulées (tests). Jeton Nuki Web (NUKI_API_TOKEN) : variable Vercel, JAMAIS en base.
--
-- 1. bien_serrure : liaison bien ↔ serrure Nuki (smartlock_id = identifiant Nuki Web, pas un secret) ; action d'ouverture
--    réglable par bien : 'unlatch' (tire le pêne : la porte s'ouvre, porte sans poignée extérieure) ou 'unlock'
--    (déverrouille seulement : le voyageur appuie sur la poignée) ; dernier état connu (en ligne / hors ligne, batterie,
--    vérifié le) écrit par api/cron-serrures.js et par chaque lecture d'état ; alerte en cours (surveillance 48 h).
-- 2. serrure_ouverture : journal des ouvertures (voyageur depuis le portail, équipe depuis PowerHouse, test) — qui, quand,
--    résultat. Lignes « voyageur » purgées avec le suivi d'arrivée (la nuit qui suit le départ, job
--    purge-portail-voyageur-journal) ; lignes équipe / test : 12 mois.
-- 3. Droit ph_droit 'serrure' (périmètre tout | agence:dcb | agence:lauian) : bouton « Ouvrir à distance », réglage de la
--    liaison. Même répartition que « modifier_resa » : Oïhan (2 comptes) toutes agences, Laura (2 comptes) Lauïan.
-- RLS : lecture staff (auth_user_is_staff), AUCUNE policy d'écriture (serveur service_role seulement).

-- ─── 1. Liaison bien ↔ serrure ────────────────────────────────────────────────────────────────────────────
create table if not exists public.bien_serrure (
  id                 uuid primary key default gen_random_uuid(),
  bien_id            uuid not null references public.bien(id) on delete cascade,
  fournisseur        text not null default 'nuki' check (fournisseur in ('nuki')),
  smartlock_id       bigint not null,
  nom                text,                                   -- nom de la serrure dans Nuki (copie, affichage)
  libelle            text,                                   -- libellé montré au voyageur (« Porte d'entrée »)
  type_appareil      integer,                                -- type Nuki : 0 Smart Lock 1/2, 2 Opener, 3 Smart Door, 4 Smart Lock 3/4, 5 Smart Lock 5
  action             text not null default 'unlatch' check (action in ('unlatch', 'unlock')),
  actif              boolean not null default true,
  voyageur_actif     boolean not null default true,          -- bouton « 🔓 Ouvrir la porte » proposé dans le portail
  etat               text not null default 'inconnu' check (etat in ('en_ligne', 'hors_ligne', 'erreur', 'inconnu')),
  batterie_pct       integer check (batterie_pct between 0 and 100),
  batterie_critique  boolean,
  etat_serrure       integer,                                -- Smartlock.State.state (1 verrouillée, 3 déverrouillée, 5 pêne tiré…)
  porte_etat         integer,                                -- Smartlock.State.doorState (2 fermée, 3 ouverte…) si capteur
  verifie_le         timestamptz,
  erreur             text,
  alerte             text,                                   -- alerte en cours (hors ligne / batterie faible avant une arrivée)
  alerte_le          timestamptz,
  alerte_empreinte   text,                                   -- évite de renvoyer le même push à chaque passage du cron
  cree_le            timestamptz not null default now(),
  cree_par           uuid,
  maj_le             timestamptz not null default now(),
  maj_par            uuid,
  unique (bien_id, smartlock_id)
);
comment on table public.bien_serrure is 'Liaison bien ↔ serrure connectée Nuki (516) : smartlock_id, action unlatch/unlock, dernier état connu. Aucun secret (jeton = variable Vercel NUKI_API_TOKEN).';
create index if not exists bien_serrure_bien on public.bien_serrure (bien_id) where actif;
alter table public.bien_serrure enable row level security;
drop policy if exists bien_serrure_lecture_staff on public.bien_serrure;
create policy bien_serrure_lecture_staff on public.bien_serrure for select to authenticated using (public.auth_user_is_staff());

-- ─── 2. Journal des ouvertures ────────────────────────────────────────────────────────────────────────────
create table if not exists public.serrure_ouverture (
  id              uuid primary key default gen_random_uuid(),
  serrure_id      uuid references public.bien_serrure(id) on delete set null,
  bien_id         uuid,
  reservation_id  uuid,
  lien_id         uuid,                                       -- lien du portail voyageur (origine voyageur)
  depart_date     date,                                       -- purge des lignes voyageur (comme le suivi d'arrivée)
  origine         text not null check (origine in ('voyageur', 'equipe', 'test')),
  par_uid         uuid,                                       -- compte PowerHouse (origine equipe)
  par_label       text,                                       -- « Oïhan », « voyageur (KO9XJT) »
  action          text not null check (action in ('unlatch', 'unlock')),
  resultat        text not null check (resultat in ('ok', 'hors_ligne', 'erreur', 'refuse', 'limite', 'simule', 'desactive')),
  detail          text,
  simule          boolean not null default false,
  le              timestamptz not null default now()
);
comment on table public.serrure_ouverture is 'Journal des ouvertures de serrure connectée (516) : voyageur (portail), équipe (PowerHouse), test. Voyageur purgé la nuit qui suit le départ ; reste 12 mois.';
create index if not exists serrure_ouverture_bien on public.serrure_ouverture (bien_id, le desc);
create index if not exists serrure_ouverture_resa on public.serrure_ouverture (reservation_id) where reservation_id is not null;
alter table public.serrure_ouverture enable row level security;
drop policy if exists serrure_ouverture_lecture_staff on public.serrure_ouverture;
create policy serrure_ouverture_lecture_staff on public.serrure_ouverture for select to authenticated using (public.auth_user_is_staff());

revoke all on public.bien_serrure, public.serrure_ouverture from anon;

-- ─── 3. Droit « serrure » ─────────────────────────────────────────────────────────────────────────────────
alter table public.ph_droit drop constraint if exists ph_droit_droit_check;
alter table public.ph_droit add constraint ph_droit_droit_check check (droit in ('perf', 'honoraires', 'admin', 'rembourser', 'stock', 'stock_admin', 'modifier_resa', 'serrure'));

create or replace function public.ph_droit_definir(p_uid uuid, p_droit text, p_actif boolean, p_perimetre text default 'tout')
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ph_est_admin() then raise exception 'acces_refuse'; end if;
  if p_droit not in ('perf', 'honoraires', 'admin', 'rembourser', 'stock', 'stock_admin', 'modifier_resa', 'serrure') then raise exception 'droit_inconnu'; end if;
  if p_droit in ('rembourser', 'modifier_resa', 'serrure') and coalesce(p_actif, false) and coalesce(nullif(p_perimetre, ''), 'tout') not in ('tout', 'agence:dcb', 'agence:lauian') then
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

create or replace function public.ph_mes_droits()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'role', auth_user_powerhouse_role(),
    'bureau', auth_user_is_bureau(),
    'zones', to_jsonb(my_secteurs()),
    'admin', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'admin'),
    'perf', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'perf'),
    'honoraires', exists (select 1 from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'honoraires'),
    'rembourser', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'rembourser'),
    'modifier_resa', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'modifier_resa'),
    'serrure', (select d.perimetre from ph_droit d where d.auth_user_id = auth.uid() and d.droit = 'serrure'),
    'stock', stock_niveau()
  );
$$;

insert into public.ph_droit (auth_user_id, droit, perimetre)
select v.uid, 'serrure', v.per
  from (values
    ('414218dc-b91b-454e-a0f2-9b4a3a0c5676'::uuid, 'tout'),
    ('62753152-5321-40ce-ac86-36a54c2de2aa'::uuid, 'tout'),
    ('e19b78dc-7507-41a2-926b-d32af02f79e9'::uuid, 'agence:lauian'),
    ('8cb18dc9-1366-47d2-b120-13b57a9630d5'::uuid, 'agence:lauian')
  ) as v(uid, per)
 where exists (select 1 from auth.users u where u.id = v.uid)
on conflict (auth_user_id, droit) do nothing;

-- ─── 4. Purge (job existant du portail voyageur) ──────────────────────────────────────────────────────────
select cron.alter_job(
  (select jobid from cron.job where jobname = 'purge-portail-voyageur-journal'),
  command := $cmd$
  delete from public.portail_voyageur_consultation where le < now() - interval '12 months';
  delete from public.portail_voyageur_evenement where le < now() - interval '12 months';
  delete from public.portail_voyageur_code where cree_le < now() - interval '12 months';
  delete from public.portail_voyageur_session where least(coalesce(revoque_le, expire_le), expire_le) < now() - interval '12 months';
  delete from public.portail_voyageur_progression where depart_date < (now() at time zone 'Europe/Paris')::date;
  delete from public.serrure_ouverture where origine = 'voyageur' and depart_date < (now() at time zone 'Europe/Paris')::date;
  delete from public.serrure_ouverture where le < now() - interval '12 months';
$cmd$);
