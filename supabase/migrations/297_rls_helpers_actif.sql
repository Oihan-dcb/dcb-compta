-- 297 — Les helpers RLS exigent une fiche auto_entrepreneur ACTIVE (02/10/2026)
-- Avant : auth_user_is_staff / _bureau / _internal ignoraient auto_entrepreneur.actif → un compte
-- archivé n'était coupé QUE par le ban GoTrue + révocation de sessions (toggle-ae-access). Si l'un
-- des deux échoue (cf. fuite de sessions 09/2026), l'archivé gardait tous ses droits RLS.
-- Après : archivé = zéro droit RLS, indépendamment de l'état de son compte Auth.

create or replace function public.auth_user_is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid())
      or exists (
           select 1 from auto_entrepreneur a
           where a.ae_user_id = auth.uid() and a.actif
             and (a.type <> 'ae' or a.acces_admin or a.acces_powerhouse)
         );
$$;

create or replace function public.auth_user_is_bureau()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid())
      or exists (
           select 1 from auto_entrepreneur a
           where a.ae_user_id = auth.uid() and a.actif
             and (a.type in ('gerant','assistante') or a.acces_admin)
         );
$$;

create or replace function public.auth_user_is_internal()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid())
      or exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif);
$$;
