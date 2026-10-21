-- 519 : portail owner — l'e-mail de la fiche propriétaire et celui du compte de connexion restent alignés.
--
-- Cause (21/10/2026, RICHOU) : la connexion au portail lit l'adresse du COMPTE auth (auth.users.email),
-- la fiche porte la sienne (proprietaire.email) et rien ne les reliait après la 1re invitation.
-- Changer l'adresse ensuite (fiche ou case « accès portail » de PowerHouse) laissait la fiche liée au
-- compte de l'ANCIENNE adresse ; l'invitation (owner-portal-invite, generateLink) créait alors un
-- second compte orphelin pour la nouvelle adresse, sans fiche → « adresse non reconnue ».
--
-- proprio_portail_aligner_compte(fiche) : si l'adresse du compte lié n'est plus sur la fiche
-- (email / email_cc), le compte passe sur la 1re adresse de proprietaire.email :
--   - aucun compte n'a cette adresse → l'adresse du compte lié est changée (l'ancienne ne connecte plus) ;
--   - un compte existe déjà (ex. créé par une invitation) → la fiche est reliée à ce compte et les
--     sessions de l'ancien compte sont fermées (l'ancien compte n'a plus de fiche : il ne voit plus rien).
-- Jamais pour une fiche super-admin, une adresse du staff ou d'un auto-entrepreneur (mêmes garde-fous
-- que /api/request-access du portail). Appelée par le trigger ci-dessous et par owner-portal-invite.

create or replace function public.proprio_portail_aligner_compte(p_proprio uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  f        public.proprietaire%rowtype;
  cur      text;
  adresses text[];
  cible    text;
  autre    uuid;
begin
  select * into f from public.proprietaire where id = p_proprio;
  if not found or f.auth_user_id is null then return 'pas_de_compte'; end if;
  if f.is_super then return 'super_admin_ignore'; end if;

  select lower(email) into cur from auth.users where id = f.auth_user_id;
  if cur is null then return 'compte_absent'; end if;

  select coalesce(array_agg(a), '{}') into adresses
    from regexp_split_to_table(lower(coalesce(f.email, '') || ' ' || coalesce(f.email_cc, '')), '[,;[:space:]]+') a
   where a <> '';
  if cur = any(adresses) then return 'deja_aligne'; end if;

  select a into cible
    from regexp_split_to_table(lower(coalesce(f.email, '')), '[,;[:space:]]+') with ordinality t(a, n)
   where a ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   order by n limit 1;
  if cible is null then return 'pas_d_adresse'; end if;

  if cible ~ '@(mail\.)?destinationcotebasque\.com$|@destinationbordeaux\.com$|@lauian(-immobilier)?\.com$'
     or exists (select 1 from public.auto_entrepreneur where lower(email) = cible) then
    return 'refuse_adresse_staff_ae';
  end if;

  select id into autre from auth.users where lower(email) = cible limit 1;

  if autre is not null then
    if exists (select 1 from public.auto_entrepreneur where ae_user_id = autre)
       or exists (select 1 from public.ph_droit where auth_user_id = autre)
       or exists (select 1 from public.staff_bien_scope where auth_user_id = autre) then
      return 'refuse_compte_staff_ae';
    end if;
    update public.proprietaire set auth_user_id = autre where id = f.id;
    -- L'ancien compte ne garde ses sessions que s'il est encore lié à une autre fiche.
    if not exists (select 1 from public.proprietaire where auth_user_id = f.auth_user_id) then
      delete from auth.sessions where user_id = f.auth_user_id;
    end if;
    return 'relie_compte_existant';
  end if;

  update auth.users
     set email = cible, email_confirmed_at = coalesce(email_confirmed_at, now()),
         email_change = '', email_change_token_new = '', email_change_token_current = '',
         updated_at = now()
   where id = f.auth_user_id;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', cible, 'email_verified', true),
         updated_at = now()
   where user_id = f.auth_user_id and provider = 'email';
  return 'email_compte_modifie';
end $$;

revoke all on function public.proprio_portail_aligner_compte(uuid) from public, anon, authenticated;
grant execute on function public.proprio_portail_aligner_compte(uuid) to service_role;

-- Trigger : une modification de l'e-mail d'une fiche (PowerHouse, dcb-compta, synchro) se répercute
-- sur le compte de connexion — seulement si le compte correspondait à la fiche AVANT la modification
-- (les écarts historiques voulus, ex. compte ouvert à une autre adresse du couple, ne sont pas touchés).
-- Une erreur ici ne doit jamais empêcher l'enregistrement de la fiche.
create or replace function public.proprio_portail_email_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare cur text;
begin
  if new.auth_user_id is null then return null; end if;
  select lower(email) into cur from auth.users where id = new.auth_user_id;
  if cur is null or not (cur = any(regexp_split_to_array(
       lower(coalesce(old.email, '') || ' ' || coalesce(old.email_cc, '')), '[,;[:space:]]+'))) then
    return null;
  end if;
  begin
    perform public.proprio_portail_aligner_compte(new.id);
  exception when others then
    raise warning '[519] alignement compte portail % : %', new.id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.proprio_portail_email_trigger() from public, anon, authenticated;

drop trigger if exists trg_proprio_portail_email on public.proprietaire;
create trigger trg_proprio_portail_email
  after update of email, email_cc on public.proprietaire
  for each row
  when (old.email is distinct from new.email or old.email_cc is distinct from new.email_cc)
  execute function public.proprio_portail_email_trigger();
