-- 326 — Salarié terrain ≠ bureau (05/10/2026, décision Oïhan : « comme une AE »).
-- Avant : auth_user_is_staff() acceptait tout type <> 'ae' → un salarié terrain (type='staff'
-- sans acces_admin ni acces_powerhouse, ex. Camille) lisait banque, IBAN agence, ventilation,
-- contrats voyageurs, propriétaires, et entrait dans PowerHouse (rôle 'staff').
-- Après : il a le profil d'une AE (portail DCB & Moi, ses missions, messagerie). Accès bureau
-- rétabli en cochant acces_admin ou acces_powerhouse sur sa fiche. Clémence (staff + admin)
-- inchangée. Point n°2 de l'audit RLS S3 (21/08/2026).
create or replace function public.auth_user_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users s where s.auth_user_id = auth.uid())
      or exists (
           select 1 from auto_entrepreneur a
           where a.ae_user_id = auth.uid() and a.actif
             and (a.type not in ('ae', 'staff') or a.acces_admin or a.acces_powerhouse)
         );
$$;

create or replace function public.auth_user_powerhouse_role()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'anon'
    when exists (select 1 from staff_users s where s.auth_user_id = auth.uid()) then 'staff'
    when exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif and a.acces_powerhouse)
      then 'staff_scope'
    when exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid() and a.actif)
      then coalesce(
        (select case when a.type = 'staff' and not coalesce(a.acces_admin, false) then 'salarie_terrain' else a.type end
           from auto_entrepreneur a
          where a.ae_user_id = auth.uid() and a.actif
          order by (a.type <> 'ae') desc limit 1),
        'ae')
    when exists (select 1 from auto_entrepreneur a where a.ae_user_id = auth.uid()) then 'inactif'
    else 'externe'
  end;
$$;
