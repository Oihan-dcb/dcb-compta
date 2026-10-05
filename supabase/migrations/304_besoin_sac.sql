-- 304 — Besoins « à mettre dans le sac » (05/10/2026)
--
-- Une AE signale pendant un ménage qu'il manque quelque chose (alèse, café…). Le besoin
-- s'affiche sur la PROCHAINE tâche du bien (PowerHouse → Tâches, portail AE → Tasks et Ma journée)
-- pour que le sac de l'AE suivante soit préparé avec. Cycle :
--   a_preparer → dans_sac (coché par la personne qui prépare le sac, rattaché à la tâche Hospitable
--   préparée : prepare_pour_task_id) → depose (coché sur place par l'AE) ; annule = retiré.
-- bien_id = bien.id (canonique). item_id optionnel (catalogue_items) : si l'article est configuré
-- dans l'inventaire du bien, le portail passe aussi son stock à « manquant » puis « OK » au dépôt.
create table if not exists public.besoin_sac (
  id                   uuid primary key default gen_random_uuid(),
  bien_id              uuid not null references public.bien(id) on delete restrict,
  item_id              uuid references public.catalogue_items(id) on delete set null,
  libelle              text not null check (length(trim(libelle)) > 0),
  quantite             integer not null default 1 check (quantite between 1 and 99),
  note                 text,
  statut               text not null default 'a_preparer'
                         check (statut in ('a_preparer', 'dans_sac', 'depose', 'annule')),
  mission_source_id    uuid references public.mission_menage(id) on delete set null,
  signale_par_ae_id    uuid references public.auto_entrepreneur(id) on delete set null,
  signale_par_user     uuid default auth.uid(),
  prepare_pour_task_id text,
  dans_sac_at          timestamptz,
  dans_sac_par         uuid,
  depose_at            timestamptz,
  depose_par_ae_id     uuid references public.auto_entrepreneur(id) on delete set null,
  depose_mission_id    uuid references public.mission_menage(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists besoin_sac_ouverts_idx on public.besoin_sac (bien_id, created_at)
  where statut in ('a_preparer', 'dans_sac');

alter table public.besoin_sac enable row level security;
-- Même périmètre que memo_bien : tout interne, staff scopé par secteur. Pas de DELETE (statut annule).
drop policy if exists besoin_sac_select on public.besoin_sac;
create policy besoin_sac_select on public.besoin_sac for select to authenticated using (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff())
);
drop policy if exists besoin_sac_insert on public.besoin_sac;
create policy besoin_sac_insert on public.besoin_sac for insert to authenticated with check (
  (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
  or (auth_user_is_internal() and not auth_user_is_staff())
);
drop policy if exists besoin_sac_update on public.besoin_sac;
create policy besoin_sac_update on public.besoin_sac for update to authenticated
  using (
    (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
    or (auth_user_is_internal() and not auth_user_is_staff())
  )
  with check (
    (auth_user_is_staff() and (my_secteurs() is null or bien_id in (select my_scoped_bien_ids())))
    or (auth_user_is_internal() and not auth_user_is_staff())
  );
