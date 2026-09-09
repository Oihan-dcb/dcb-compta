-- 254_acces_powerhouse_scope.sql
-- Découple "accès PowerHouse" de auto_entrepreneur.type (qui reste la vérité paie/Portail AE).
--
-- Constat (09/09/2026) : auth_user_powerhouse_role() (et donc 90-auth-gate.jsx +
-- auth_user_is_staff(), la vraie frontière RLS) exigeaient type IN ('staff','gerant','assistante')
-- pour entrer dans PowerHouse. Impossible de donner un accès PowerHouse scopé (Léa/Bordeaux,
-- migrations 222-223-252) à quelqu'un dont le `type` doit rester 'ae' pour d'autres raisons
-- (paie, Portail AE) sans lui faire perdre ce statut. Ni `secteurs` seul (migration 222) ni
-- `type='ae'` ne suffisaient : `secteurs` ne fait QUE réduire un périmètre déjà accordé.
--
-- acces_powerhouse est un flag GÉNÉRIQUE, pensé pour être réutilisé sans nouvelle migration
-- (donner un accès PowerHouse scopé à quelqu'un = 2 clics : ce flag + secteurs) — y compris dans
-- l'optique d'une commercialisation future de PowerHouse à d'autres conciergeries (cf. memory
-- project_powerhouse_commercialization_intent_2026-09) : ne PAS resserrer ce mécanisme sur un cas
-- DCB-spécifique (ex. pas de colonne "acces_bordeaux", un booléen + secteurs generic suffit).

alter table auto_entrepreneur add column if not exists acces_powerhouse boolean not null default false;

comment on column auto_entrepreneur.acces_powerhouse is
  'Donne l''accès PowerHouse SANS changer `type` (qui reste la vérité paie/Portail AE) — combiné '
  'avec `secteurs` pour un accès scopé géographiquement. false par défaut : n''accorde jamais '
  'l''accès tout seul, doit être posé explicitement par le bureau (cf. trigger anti-auto-élévation).';

-- ── RLS : auth_user_is_staff() reconnaît maintenant ce flag ────────────────────────────────
-- (auth_user_is_bureau() n'a pas besoin de changer : acces_powerhouse ne donne PAS un accès admin.)
create or replace function public.auth_user_is_staff()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT EXISTS (SELECT 1 FROM staff_users s WHERE s.auth_user_id = auth.uid())
      OR EXISTS (
           SELECT 1 FROM auto_entrepreneur a
           WHERE a.ae_user_id = auth.uid() AND (a.type <> 'ae' OR a.acces_admin OR a.acces_powerhouse)
         );
$function$;

-- ── Rôle exposé à l'UI (90-auth-gate.jsx) et aux endpoints api/*.js ────────────────────────
-- Nouveau rôle distinct 'staff_scope' (plutôt que renvoyer 'staff') : un type='ae' avec
-- acces_powerhouse=true reste visiblement différent d'un vrai compte staff_users/type staff dans
-- tout code qui lira ce rôle plus tard — le champ affiché ne doit jamais laisser croire que
-- `type` a changé. PH_ALLOWED_ROLES (8 fichiers dcb-planning) doit inclure 'staff_scope' pour que
-- ce rôle passe réellement la porte — fait dans le même lot de commits que cette migration.
create or replace function public.auth_user_powerhouse_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when auth.uid() is null then 'anon'
    when exists (select 1 from staff_users s where s.auth_user_id = auth.uid()) then 'staff'
    when exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif and a.acces_powerhouse)
      then 'staff_scope'
    when exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif)
      then coalesce(
        (select a.type from auto_entrepreneur a
          where a.ae_user_id = auth.uid() and a.actif
          order by (a.type <> 'ae') desc limit 1),
        'ae')
    when exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid()) then 'inactif'
    else 'externe'
  end;
$function$;

-- ── Anti-auto-élévation : acces_powerhouse rejoint la liste des champs réservés au bureau ──
create or replace function public.auto_entrepreneur_prevent_self_elevation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth_user_is_bureau() then
    return new;
  end if;
  if new.type is distinct from old.type
     or new.acces_admin is distinct from old.acces_admin
     or new.acces_powerhouse is distinct from old.acces_powerhouse
     or new.voit_toutes_agences is distinct from old.voit_toutes_agences
     or new.secteurs is distinct from old.secteurs
     or new.ae_user_id is distinct from old.ae_user_id
     or new.linked_ae_user_id is distinct from old.linked_ae_user_id
  then
    raise exception 'Modification de champs réservés au bureau refusée' using errcode = '42501';
  end if;
  return new;
end;
$function$;
