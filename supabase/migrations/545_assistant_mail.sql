-- 545 — Assistant mail PowerHouse (22/10/2026). Demande d'Oïhan : « un tri de mes mails : spam poubelle, demandes de résa
-- transférées à PowerHouse comme demande de résa client (ou à Clémence sur conciergerie), que si je ne regarde pas ma boîte
-- pendant 3 jours il n'y ait pas de problème, et que PowerHouse propose des réponses comme une assistante ».
--
-- Réutilise l'ancien module mail (085 powerhouse_imap_accounts, 092 mail_messages) : le code qui les remplissait a été retiré
-- le 28/05/2026 (commit dcb-planning 9c32d03 ; l'import mail_messages, lui, n'a vécu que sur la branche sandbox → rien après
-- le 10/05/2026). Les comptes deviennent des « boîtes » : protocole EWS (Exchange OVH, oihan@) ou IMAP (MX Plan, conciergerie@),
-- mot de passe saisi par la personne dans PowerHouse et rangé dans Supabase Vault (secret « mail_mdp_<id> »), jamais renvoyé
-- au navigateur ; l'ancien password_enc (AES, clé Vercel) est effacé dès qu'un mot de passe Vault est posé.
--
-- Interrupteur PAR BOÎTE : eteint (rien) / essai (défaut : synchronisation + tri affichés, AUCUNE action sur la boîte) /
-- actif (déplacements Indésirable / Promotions + création des demandes de réservation). Envois (réponses, transferts) : TOUJOURS
-- un clic de la personne, jamais automatiques.
--
-- Accès : boîtes PERSONNELLES → seules les personnes listées dans acces_uids voient la boîte et ses mails (API service_role ;
-- plus aucune lecture directe pour authenticated : avant, tout le « bureau » pouvait lire mail_messages).

-- ─── 1. Boîtes (powerhouse_imap_accounts) ─────────────────────────────────────────────────────────────────
alter table public.powerhouse_imap_accounts alter column password_enc drop not null;
alter table public.powerhouse_imap_accounts add column if not exists protocole text not null default 'imap';
alter table public.powerhouse_imap_accounts drop constraint if exists powerhouse_imap_accounts_protocole_check;
alter table public.powerhouse_imap_accounts add constraint powerhouse_imap_accounts_protocole_check check (protocole in ('ews', 'imap'));
alter table public.powerhouse_imap_accounts add column if not exists ews_url text;
alter table public.powerhouse_imap_accounts add column if not exists identifiant text;           -- login si différent de l'e-mail
alter table public.powerhouse_imap_accounts add column if not exists role text not null default 'autre';
alter table public.powerhouse_imap_accounts drop constraint if exists powerhouse_imap_accounts_role_check;
alter table public.powerhouse_imap_accounts add constraint powerhouse_imap_accounts_role_check check (role in ('principal', 'conciergerie', 'autre'));
alter table public.powerhouse_imap_accounts add column if not exists mode text not null default 'essai';
alter table public.powerhouse_imap_accounts drop constraint if exists powerhouse_imap_accounts_mode_check;
alter table public.powerhouse_imap_accounts add constraint powerhouse_imap_accounts_mode_check check (mode in ('eteint', 'essai', 'actif'));
alter table public.powerhouse_imap_accounts add column if not exists mode_maj_le timestamptz;
alter table public.powerhouse_imap_accounts add column if not exists mode_maj_par text;
alter table public.powerhouse_imap_accounts add column if not exists mdp_present boolean not null default false;
alter table public.powerhouse_imap_accounts add column if not exists mdp_ajoute_le timestamptz;
alter table public.powerhouse_imap_accounts add column if not exists mdp_ajoute_par text;
alter table public.powerhouse_imap_accounts add column if not exists verifie_le timestamptz;
alter table public.powerhouse_imap_accounts add column if not exists verifie_ok boolean;
alter table public.powerhouse_imap_accounts add column if not exists verifie_msg text;
alter table public.powerhouse_imap_accounts add column if not exists auth_variante text;        -- EWS : variante NTLM qui a marché
alter table public.powerhouse_imap_accounts add column if not exists sync_le timestamptz;
alter table public.powerhouse_imap_accounts add column if not exists sync_ok boolean;
alter table public.powerhouse_imap_accounts add column if not exists sync_msg text;
alter table public.powerhouse_imap_accounts add column if not exists sync_echecs int not null default 0;
alter table public.powerhouse_imap_accounts add column if not exists sync_depuis timestamptz;     -- fenêtre initiale (30 j)
alter table public.powerhouse_imap_accounts add column if not exists curseurs jsonb not null default '{}'::jsonb; -- dernier reçu par dossier
alter table public.powerhouse_imap_accounts add column if not exists dossiers jsonb not null default '{}'::jsonb; -- id du dossier Promotions…
alter table public.powerhouse_imap_accounts add column if not exists acces_uids uuid[] not null default '{}';
alter table public.powerhouse_imap_accounts add column if not exists recap_le date;
alter table public.powerhouse_imap_accounts add column if not exists cree_par text;
comment on table public.powerhouse_imap_accounts is 'Boîtes mail branchées sur PowerHouse (085, assistant mail 545) : EWS ou IMAP, mot de passe dans Vault mail_mdp_<id>, interrupteur eteint/essai/actif, accès = acces_uids.';

-- Boîte d'Oïhan (créée en 04/2026 en IMAP ex5) → EWS, Essai, accès Oïhan (compte pro + compte personnel). Mot de passe à ressaisir
-- dans PowerHouse (Paramètres › Intégrations › 📬 Messagerie) : rien n'est repris de l'ancien chiffrement.
update public.powerhouse_imap_accounts
   set protocole = 'ews', ews_url = 'https://ex5.mail.ovh.net/EWS/Exchange.asmx', email = lower(email), label = 'Oïhan', role = 'principal',
       mode = 'essai', mdp_present = false, active = true,
       acces_uids = array['414218dc-b91b-454e-a0f2-9b4a3a0c5676', '62753152-5321-40ce-ac86-36a54c2de2aa']::uuid[]
 where lower(email) = 'oihan@destinationcotebasque.com';

-- ─── 2. Mot de passe dans Vault (service_role seul) ───────────────────────────────────────────────────────
create or replace function public.mail_mdp_poser(p_compte uuid, p_mdp text)
returns void language plpgsql security definer set search_path to 'public', 'vault' as $$
declare v_id uuid; v_nom text;
begin
  if not exists (select 1 from public.powerhouse_imap_accounts where id = p_compte) then raise exception 'compte_inconnu'; end if;
  if p_mdp is null or length(p_mdp) < 1 or length(p_mdp) > 256 then raise exception 'mdp_invalide'; end if;
  v_nom := 'mail_mdp_' || p_compte::text;
  select id into v_id from vault.secrets where name = v_nom;
  if v_id is null then perform vault.create_secret(p_mdp, v_nom, 'Mot de passe de boîte mail (PowerHouse, assistant mail)');
  else perform vault.update_secret(v_id, p_mdp); end if;
  update public.powerhouse_imap_accounts set password_enc = null where id = p_compte; -- ancien chiffrement AES effacé
end $$;
create or replace function public.mail_mdp_lire(p_compte uuid)
returns text language sql stable security definer set search_path to 'public', 'vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'mail_mdp_' || p_compte::text limit 1;
$$;
create or replace function public.mail_mdp_supprimer(p_compte uuid)
returns void language sql security definer set search_path to 'public', 'vault' as $$
  delete from vault.secrets where name = 'mail_mdp_' || p_compte::text;
$$;
revoke all on function public.mail_mdp_poser(uuid, text) from public, anon, authenticated;
revoke all on function public.mail_mdp_lire(uuid) from public, anon, authenticated;
revoke all on function public.mail_mdp_supprimer(uuid) from public, anon, authenticated;
grant execute on function public.mail_mdp_poser(uuid, text) to service_role;
grant execute on function public.mail_mdp_lire(uuid) to service_role;
grant execute on function public.mail_mdp_supprimer(uuid) to service_role;

-- ─── 3. Messages : tri, dossier, réponse, suivi ───────────────────────────────────────────────────────────
alter table public.mail_messages add column if not exists ext_id text;            -- EWS ItemId / IMAP « dossier|uidvalidity|uid »
alter table public.mail_messages add column if not exists ext_cle text;           -- EWS ChangeKey
alter table public.mail_messages add column if not exists conversation_id text;
alter table public.mail_messages add column if not exists in_reply_to text;
alter table public.mail_messages add column if not exists reply_to text;
alter table public.mail_messages add column if not exists dossier text not null default 'inbox';
alter table public.mail_messages add column if not exists entetes jsonb;          -- quelques en-têtes utiles au tri (pas tout)
alter table public.mail_messages add column if not exists categorie text;
alter table public.mail_messages add column if not exists tri_source text;
alter table public.mail_messages add column if not exists tri_raison text;
alter table public.mail_messages add column if not exists tri_confiance numeric;
alter table public.mail_messages add column if not exists tri_le timestamptz;
alter table public.mail_messages add column if not exists important boolean not null default false;
alter table public.mail_messages add column if not exists protege boolean not null default false;
alter table public.mail_messages add column if not exists action_prevue text;
alter table public.mail_messages add column if not exists action_faite text;
alter table public.mail_messages add column if not exists action_le timestamptz;
alter table public.mail_messages add column if not exists repondu_le timestamptz;
alter table public.mail_messages add column if not exists traite_le timestamptz;
alter table public.mail_messages add column if not exists traite_par text;
alter table public.mail_messages add column if not exists ia_besoin boolean not null default false;
alter table public.mail_messages add column if not exists ia_le timestamptz;
alter table public.mail_messages add column if not exists extraction jsonb;
alter table public.mail_messages add column if not exists vu_le timestamptz;
alter table public.mail_messages drop constraint if exists mail_messages_categorie_check;
alter table public.mail_messages add constraint mail_messages_categorie_check check (categorie is null or categorie in
  ('spam', 'promo', 'notification', 'demande_resa', 'voyageur', 'proprietaire', 'prestataire', 'equipe', 'administratif', 'autre'));
alter table public.mail_messages drop constraint if exists mail_messages_dossier_check;
alter table public.mail_messages add constraint mail_messages_dossier_check check (dossier in ('inbox', 'sentitems', 'junk', 'promotions', 'autre'));
create index if not exists mail_messages_compte_dossier_date on public.mail_messages (account_id, dossier, date desc);
create index if not exists mail_messages_importants on public.mail_messages (account_id, date) where important and repondu_le is null and traite_le is null;
create index if not exists mail_messages_conversation on public.mail_messages (account_id, conversation_id);
create index if not exists mail_messages_message_id on public.mail_messages (account_id, message_id);

-- ─── 4. Journal de chaque décision (réversible) ───────────────────────────────────────────────────────────
create table if not exists public.mail_tri_journal (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.powerhouse_imap_accounts(id) on delete cascade,
  message_id  uuid references public.mail_messages(id) on delete cascade,
  le          timestamptz not null default now(),
  mode        text,
  evenement   text not null check (evenement in ('classe', 'deplace', 'simule', 'remis', 'demande_creee', 'demande_simulee',
                'recategorise', 'transfert', 'reponse', 'ia', 'erreur', 'traite', 'connexion', 'test', 'mode', 'sync')),
  de          text,
  vers        text,
  detail      text,
  par_label   text
);
create index if not exists mail_tri_journal_compte on public.mail_tri_journal (account_id, le desc);
create index if not exists mail_tri_journal_message on public.mail_tri_journal (message_id, le desc);

-- ─── 5. Brouillons de réponse / transferts proposés ───────────────────────────────────────────────────────
create table if not exists public.mail_brouillon (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.mail_messages(id) on delete cascade,
  account_id    uuid not null references public.powerhouse_imap_accounts(id) on delete cascade,
  type          text not null default 'reponse' check (type in ('reponse', 'transfert')),
  destinataire  text,
  sujet         text,
  corps         text not null,
  source        text not null default 'modele' check (source in ('ia', 'modele', 'manuel')),
  modele        text,
  contexte      jsonb,
  cout_usd      numeric,
  statut        text not null default 'propose' check (statut in ('propose', 'envoye', 'abandonne', 'erreur')),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz,
  envoye_le     timestamptz,
  envoye_par    text,
  erreur        text,
  anonymise_le  timestamptz
);
create index if not exists mail_brouillon_message on public.mail_brouillon (message_id, cree_le desc);

-- ─── 6. Journal des appels IA (coût) ──────────────────────────────────────────────────────────────────────
create table if not exists public.mail_ia_journal (
  id          uuid primary key default gen_random_uuid(),
  le          timestamptz not null default now(),
  account_id  uuid references public.powerhouse_imap_accounts(id) on delete set null,
  objet       text not null check (objet in ('tri', 'brouillon')),
  nb          int not null default 1,
  modele      text,
  cout_usd    numeric,
  detail      text
);
create index if not exists mail_ia_journal_le on public.mail_ia_journal (le desc);

-- ─── 7. Règles apprises (« toujours classer cet expéditeur en … ») ───────────────────────────────────────
create table if not exists public.mail_regle (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references public.powerhouse_imap_accounts(id) on delete cascade,
  motif       text not null check (motif ~ '^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$'),
  categorie   text not null check (categorie in ('spam', 'promo', 'notification', 'demande_resa', 'voyageur', 'proprietaire', 'prestataire', 'equipe', 'administratif', 'autre')),
  actif       boolean not null default true,
  cree_le     timestamptz not null default now(),
  cree_par    text
);
create unique index if not exists mail_regle_unique on public.mail_regle (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), motif);

-- ─── 8. Demandes de réservation venues d'un mail (même flux que le site : direct_demande) ─────────────────
alter table public.direct_demande add column if not exists source text not null default 'site';
alter table public.direct_demande drop constraint if exists direct_demande_source_check;
alter table public.direct_demande add constraint direct_demande_source_check check (source in ('site', 'mail'));
alter table public.direct_demande add column if not exists mail_message_id uuid references public.mail_messages(id) on delete set null;
alter table public.direct_demande add column if not exists agence text;
alter table public.direct_demande alter column bien_id drop not null;
alter table public.direct_demande alter column arrivee drop not null;
alter table public.direct_demande alter column depart drop not null;
alter table public.direct_demande alter column adultes drop not null;
alter table public.direct_demande alter column voyageur_prenom drop not null;
alter table public.direct_demande alter column voyageur_nom drop not null;
alter table public.direct_demande alter column total_centimes drop not null;
alter table public.direct_demande alter column consentement drop not null;
alter table public.direct_demande drop constraint if exists direct_demande_site_complet;
alter table public.direct_demande add constraint direct_demande_site_complet check (source = 'mail' or (bien_id is not null and arrivee is not null
  and depart is not null and adultes is not null and voyageur_prenom is not null and voyageur_nom is not null and total_centimes is not null and consentement is not null));
create unique index if not exists direct_demande_mail_unique on public.direct_demande (mail_message_id) where mail_message_id is not null;
comment on column public.direct_demande.source is 'site = page Réserver / widget ; mail = demande reçue par e-mail (assistant mail 545), logement/dates éventuellement à compléter';

-- ─── 9. Droits : plus aucune lecture directe des boîtes (API service_role + acces_uids) ───────────────────
drop policy if exists staff_all_mail_messages on public.mail_messages;
drop policy if exists staff_all_mail_ai_analysis on public.mail_ai_analysis;
drop policy if exists staff_all_powerhouse_imap_accounts on public.powerhouse_imap_accounts;
drop policy if exists authenticated_all_powerhouse_imap_accounts on public.powerhouse_imap_accounts;
revoke all on public.mail_messages, public.mail_ai_analysis, public.powerhouse_imap_accounts from anon, authenticated;
alter table public.mail_tri_journal enable row level security;
alter table public.mail_brouillon enable row level security;
alter table public.mail_ia_journal enable row level security;
alter table public.mail_regle enable row level security;
revoke all on public.mail_tri_journal, public.mail_brouillon, public.mail_ia_journal, public.mail_regle from anon, authenticated;

-- ─── 10. Anonymisation (règle 5 ans de 438) : suit le message ─────────────────────────────────────────────
create or replace function public.mail_messages_anonymise_suite() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.anonymise_le is not null and old.anonymise_le is null then
    new.reply_to := case when new.reply_to is null then null else '[email]' end;
    new.extraction := null;
    new.entetes := null;
    new.tri_raison := anon_texte(new.tri_raison, array[old.from_name]);
    update mail_brouillon set corps = anon_texte(corps, array[old.from_name]), sujet = anon_texte(sujet, array[old.from_name]),
           destinataire = case when destinataire is null then null else '[email]' end, contexte = null, anonymise_le = new.anonymise_le
     where message_id = new.id and anonymise_le is null;
  end if;
  return new;
end $$;
drop trigger if exists mail_messages_anonymise_suite on public.mail_messages;
create trigger mail_messages_anonymise_suite before update of anonymise_le on public.mail_messages
  for each row execute function public.mail_messages_anonymise_suite();

-- ─── 11. Mails de l'ancien module (626 lignes, 09/04 → 10/05/2026, import IMAP sans identifiant de boîte) ─────────────────
-- Ni ext_id ni tri : rangés à part (dossier « autre », tri_source « ancien_module ») pour que l'assistant ne les retrie pas,
-- ne les déplace jamais et ne les compte pas dans le filet. Appliqué le 22/10/2026.
update public.mail_messages set tri_le = now(), tri_source = 'ancien_module', dossier = 'autre' where ext_id is null and tri_le is null;
