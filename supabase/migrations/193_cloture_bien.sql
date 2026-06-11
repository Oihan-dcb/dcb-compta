-- Clôture par bien/mois : l'envoi de la facture à Evoliz fige le bien.
-- Après clôture, plus aucune écriture prestation/mission possible (sauf service_role).
-- Inerte tant qu'aucune ligne cloture_bien active n'existe.

-- 1. Table de clôture (une ligne active max par bien/mois)
create table if not exists cloture_bien (
  id          uuid primary key default gen_random_uuid(),
  agence      text not null default 'dcb',
  bien_id     uuid not null references bien(id) on delete cascade,
  mois        text not null,                       -- 'YYYY-MM'
  active      boolean not null default true,
  facture_id  uuid references facture_evoliz(id) on delete set null,
  closed_by   text,
  closed_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create unique index if not exists cloture_bien_active_uq
  on cloture_bien (bien_id, mois) where active;
create index if not exists cloture_bien_lookup on cloture_bien (bien_id, mois) where active;

-- 2. Journal d'audit (clôtures + réouvertures)
create table if not exists cloture_bien_log (
  id        uuid primary key default gen_random_uuid(),
  bien_id   uuid,
  mois      text,
  action    text not null,            -- 'cloture' | 'reouverture'
  par       text,
  motif     text,
  at        timestamptz not null default now()
);

-- 3. Helper : ce bien/mois est-il clos ? (SECURITY DEFINER pour éviter la récursion RLS)
create or replace function bien_mois_clos(p_bien_id uuid, p_mois text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cloture_bien c
    where c.bien_id = p_bien_id and c.mois = p_mois and c.active
  );
$$;

-- 4. RLS cloture_bien : lecture libre ; insert par l'app (push Evoliz) ;
--    PAS d'update/delete pour anon/authenticated → réouverture seulement via service_role (edge fn Oïhan)
alter table cloture_bien enable row level security;
create policy cloture_select on cloture_bien for select to anon, authenticated using (true);
create policy cloture_insert on cloture_bien for insert to anon, authenticated with check (true);

alter table cloture_bien_log enable row level security;
create policy cloture_log_select on cloture_bien_log for select to anon, authenticated using (true);
create policy cloture_log_insert on cloture_bien_log for insert to anon, authenticated with check (true);

-- 5. Verrou RESTRICTIVE (s'AJOUTE en AND aux policies existantes, ne les remplace pas).
--    service_role bypasse la RLS -> crons / ventilation / sync iCal non impactes.

-- prestation_hors_forfait
create policy phf_clos_no_insert on prestation_hors_forfait
  as restrictive for insert to anon, authenticated
  with check (not bien_mois_clos(bien_id, mois));
create policy phf_clos_no_update on prestation_hors_forfait
  as restrictive for update to anon, authenticated
  using (not bien_mois_clos(bien_id, mois))
  with check (not bien_mois_clos(bien_id, mois));
create policy phf_clos_no_delete on prestation_hors_forfait
  as restrictive for delete to anon, authenticated
  using (not bien_mois_clos(bien_id, mois));

-- mission_menage
create policy mm_clos_no_insert on mission_menage
  as restrictive for insert to anon, authenticated
  with check (not bien_mois_clos(bien_id, mois));
create policy mm_clos_no_update on mission_menage
  as restrictive for update to anon, authenticated
  using (not bien_mois_clos(bien_id, mois))
  with check (not bien_mois_clos(bien_id, mois));
create policy mm_clos_no_delete on mission_menage
  as restrictive for delete to anon, authenticated
  using (not bien_mois_clos(bien_id, mois));
