-- 223_staff_scope_foundation.sql
-- Phase 2a (accès staff scopé géographique — dossier Léa Escudier / Bordeaux+Bassin, audit 09/09/2026).
-- Fondations : table d'exceptions, fonctions RLS, garde-fou anti-auto-élévation, policies `bien`.
-- Comportement inchangé pour tout le monde AUJOURD'HUI : secteurs est NULL pour tous les comptes
-- existants → my_secteurs() renvoie NULL → toutes les nouvelles policies équivalent à l'ancien
-- comportement (auth_user_is_staff() tout court). Vérifié par tests d'impersonation ci-dessous.

-- ── Table d'exceptions (Option B) : accès ponctuel à un bien hors du secteur du compte ──────
create table if not exists staff_bien_scope (
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  bien_id       uuid not null references bien(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (auth_user_id, bien_id)
);
alter table staff_bien_scope enable row level security;
drop policy if exists staff_bien_scope_bureau on staff_bien_scope;
create policy staff_bien_scope_bureau on staff_bien_scope for all to authenticated
  using (auth_user_is_bureau()) with check (auth_user_is_bureau());

-- ── my_secteurs() : NULL = accès à tous les secteurs (comptes staff_users et comptes
-- auto_entrepreneur sans secteurs défini, càd tout le monde à ce jour) ──────────────────────
create or replace function my_secteurs()
returns text[]
language sql stable security definer
set search_path = 'public'
as $$
  select case
    when exists (select 1 from staff_users s where s.auth_user_id = auth.uid()) then null
    else (select a.secteurs from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif limit 1)
  end;
$$;

-- ── my_scoped_bien_ids() : à utiliser dans les policies des tables AUTRES que `bien` (qui ont
-- un bien_id en FK). Pour `bien` elle-même, voir plus bas — le check inline évite le problème
-- d'auto-référence sur INSERT (la nouvelle ligne n'existe pas encore dans `bien` au moment du
-- WITH CHECK, donc `id in (select my_scoped_bien_ids())` échouerait toujours pour un INSERT).
create or replace function my_scoped_bien_ids()
returns setof uuid
language sql stable security definer
set search_path = 'public'
as $$
  select b.id from bien b
  where my_secteurs() is null or b.secteur = any(my_secteurs())
  union
  select bs.bien_id from staff_bien_scope bs where bs.auth_user_id = auth.uid();
$$;

-- ── Garde-fou anti-auto-élévation sur auto_entrepreneur ─────────────────────────────────────
-- La policy ae_update autorise déjà auth_user_owns_ae(id) à modifier SA PROPRE ligne (self-service
-- téléphone/notif etc.), mais rien ne bloquait au niveau RLS un appel REST direct changeant son
-- propre type/acces_admin/voit_toutes_agences/secteurs — seul le frontend (STAFF_EDITABLE_FIELDS
-- exclut ces 3 premiers) le filtrait. Faille pré-existante, indépendante du dossier Léa mais du
-- même risque que celui identifié par l'audit RLS S3 (auto-élévation). Vérifié 09/09/2026 :
-- seul saveStaffField (frontend, écriture authentifiée bureau) touche ces colonnes en écriture ;
-- aucun endpoint api/*.js en service_role ne les modifie → trigger sans risque de régression.
create or replace function auto_entrepreneur_prevent_self_elevation()
returns trigger
language plpgsql security definer
set search_path = 'public'
as $$
begin
  if auth_user_is_bureau() then
    return new;
  end if;
  if new.type is distinct from old.type
     or new.acces_admin is distinct from old.acces_admin
     or new.voit_toutes_agences is distinct from old.voit_toutes_agences
     or new.secteurs is distinct from old.secteurs
     or new.ae_user_id is distinct from old.ae_user_id
     or new.linked_ae_user_id is distinct from old.linked_ae_user_id
  then
    raise exception 'Modification de champs réservés au bureau refusée' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_auto_entrepreneur_prevent_self_elevation on auto_entrepreneur;
create trigger trg_auto_entrepreneur_prevent_self_elevation
  before update on auto_entrepreneur
  for each row execute function auto_entrepreneur_prevent_self_elevation();

-- ── Policies `bien` : check inline (pas my_scoped_bien_ids(), cf. commentaire ci-dessus) ────
drop policy if exists bien_select_scoped on bien;
create policy bien_select_scoped on bien for select to authenticated
using (
  (auth_user_is_staff() and (my_secteurs() is null or secteur = any(my_secteurs())
    or id in (select bien_id from staff_bien_scope where auth_user_id = auth.uid())))
  or proprietaire_id in (select my_proprietaire_ids())
  or co_proprietaire_id in (select my_proprietaire_ids())
  or exists (
    select 1 from mission_menage m join auto_entrepreneur a on a.id = m.ae_id
    where m.bien_id = bien.id and a.ae_user_id = auth.uid()
  )
);

drop policy if exists bien_staff_write on bien;
create policy bien_staff_write on bien for all to authenticated
using (auth_user_is_staff() and (my_secteurs() is null or secteur = any(my_secteurs())
  or id in (select bien_id from staff_bien_scope where auth_user_id = auth.uid())))
with check (auth_user_is_staff() and (my_secteurs() is null or secteur = any(my_secteurs())
  or id in (select bien_id from staff_bien_scope where auth_user_id = auth.uid())));
