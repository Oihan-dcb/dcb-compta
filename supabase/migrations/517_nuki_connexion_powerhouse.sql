-- 517 — Connexion Nuki pilotée depuis PowerHouse (20/10/2026, retour d'Oïhan : « l'intégrer dans la page, comme connecter à
-- Nuki ; ne pas dépendre de Claude Code »). Suite de 516 (serrures connectées, préparé, désactivé).
--
-- OAuth Nuki Web : réservé à l'« Advanced API » (demande d'intégrateur validée par Nuki, client_id / secret, URL de retour
-- déclarée) → pas utilisable aujourd'hui. Connexion par JETON API Nuki Web collé dans PowerHouse (Réglages › Intégrations ›
-- 🔐 Nuki), un par agence, rangé dans Supabase Vault ; la table ne garde que les 4 derniers caractères.
--
-- 1. nuki_connexion (une ligne par agence) : interrupteur Éteint / Essai (simulé) / Actif (remplace la variable Vercel
--    NUKI_ACTIF, qui ne reste qu'un coupe-circuit : NUKI_ACTIF=off coupe tout), jeton présent / fin / ajouté le / par,
--    dernier test. Lecture staff ; écriture serveur seulement (api/serrure.js, droit ph_droit 'serrure').
-- 2. nuki_journal : qui a connecté, remplacé, déconnecté, changé l'interrupteur, testé (sans le jeton).
-- 3. Jeton : nuki_jeton_poser / nuki_jeton_lire / nuki_jeton_supprimer (security definer, service_role SEUL) → Vault
--    (secret « nuki_jeton_<agence> »). Jamais renvoyé au navigateur.
-- 4. bien_serrure : cle (bouton d'une serrure précise dans le guide : {{bouton_ouverture_<cle>}}), porte_commune (porte
--    d'entrée d'une résidence : la même serrure peut être liée à plusieurs biens), carte_au_dessus (carte « Ouvrir la porte »
--    au-dessus du guide même si le guide ne porte pas le champ). Une serrure = un seul bien, sauf porte commune (trigger).

create table if not exists public.nuki_connexion (
  agence                 text primary key check (agence in ('dcb', 'lauian')),
  mode                   text not null default 'eteint' check (mode in ('eteint', 'essai', 'actif')),
  mode_maj_le            timestamptz,
  mode_maj_par_label     text,
  jeton_present          boolean not null default false,
  jeton_fin              text check (jeton_fin is null or length(jeton_fin) <= 4),
  jeton_ajoute_le        timestamptz,
  jeton_ajoute_par       uuid,
  jeton_ajoute_par_label text,
  verifie_le             timestamptz,
  verifie_ok             boolean,
  verifie_msg            text
);
comment on table public.nuki_connexion is 'Connexion Nuki Web par agence (517) : interrupteur eteint/essai/actif, jeton présent (fin seulement, secret dans Vault nuki_jeton_<agence>), dernier test.';
insert into public.nuki_connexion (agence) values ('dcb'), ('lauian') on conflict do nothing;
alter table public.nuki_connexion enable row level security;
drop policy if exists nuki_connexion_lecture_staff on public.nuki_connexion;
create policy nuki_connexion_lecture_staff on public.nuki_connexion for select to authenticated using (public.auth_user_is_staff());

create table if not exists public.nuki_journal (
  id         uuid primary key default gen_random_uuid(),
  agence     text not null,
  le         timestamptz not null default now(),
  par_uid    uuid,
  par_label  text,
  evenement  text not null check (evenement in ('jeton_ajoute', 'jeton_remplace', 'deconnecte', 'mode', 'test', 'liaison', 'dissociation')),
  detail     text
);
create index if not exists nuki_journal_agence on public.nuki_journal (agence, le desc);
alter table public.nuki_journal enable row level security;
drop policy if exists nuki_journal_lecture_staff on public.nuki_journal;
create policy nuki_journal_lecture_staff on public.nuki_journal for select to authenticated using (public.auth_user_is_staff());
revoke all on public.nuki_connexion, public.nuki_journal from anon;

-- ─── Jeton dans Vault (service_role seulement) ────────────────────────────────────────────────────────────
create or replace function public.nuki_jeton_poser(p_agence text, p_jeton text)
returns void language plpgsql security definer set search_path to 'public', 'vault' as $$
declare v_id uuid; v_nom text;
begin
  if p_agence not in ('dcb', 'lauian') then raise exception 'agence_invalide'; end if;
  if p_jeton is null or length(p_jeton) < 20 or length(p_jeton) > 400 or p_jeton ~ '\s' then raise exception 'jeton_invalide'; end if;
  v_nom := 'nuki_jeton_' || p_agence;
  select id into v_id from vault.secrets where name = v_nom;
  if v_id is null then perform vault.create_secret(p_jeton, v_nom, 'Jeton API Nuki Web (PowerHouse, agence ' || p_agence || ')');
  else perform vault.update_secret(v_id, p_jeton); end if;
end $$;
create or replace function public.nuki_jeton_lire(p_agence text)
returns text language sql stable security definer set search_path to 'public', 'vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'nuki_jeton_' || p_agence limit 1;
$$;
create or replace function public.nuki_jeton_supprimer(p_agence text)
returns void language sql security definer set search_path to 'public', 'vault' as $$
  delete from vault.secrets where name = 'nuki_jeton_' || p_agence;
$$;
revoke all on function public.nuki_jeton_poser(text, text) from public, anon, authenticated;
revoke all on function public.nuki_jeton_lire(text) from public, anon, authenticated;
revoke all on function public.nuki_jeton_supprimer(text) from public, anon, authenticated;
grant execute on function public.nuki_jeton_poser(text, text) to service_role;
grant execute on function public.nuki_jeton_lire(text) to service_role;
grant execute on function public.nuki_jeton_supprimer(text) to service_role;

-- ─── bien_serrure : clé du bouton, porte commune, carte au-dessus du guide ────────────────────────────────
alter table public.bien_serrure add column if not exists cle text check (cle is null or cle ~ '^[a-z]{1,20}$');
alter table public.bien_serrure add column if not exists porte_commune boolean not null default false;
alter table public.bien_serrure add column if not exists carte_au_dessus boolean not null default false;
create unique index if not exists bien_serrure_cle_unique on public.bien_serrure (bien_id, cle) where actif and cle is not null;

create or replace function public.bien_serrure_unicite() returns trigger language plpgsql as $$
begin
  if new.actif and exists (select 1 from public.bien_serrure s where s.smartlock_id = new.smartlock_id and s.actif and s.id <> new.id
       and s.bien_id <> new.bien_id and not (s.porte_commune and new.porte_commune)) then
    raise exception 'serrure_deja_liee' using hint = 'Une serrure ne peut être liée qu''à un seul bien, sauf « porte d''entrée commune » cochée sur chaque liaison.';
  end if;
  return new;
end $$;
drop trigger if exists bien_serrure_unicite on public.bien_serrure;
create trigger bien_serrure_unicite before insert or update on public.bien_serrure for each row execute function public.bien_serrure_unicite();
