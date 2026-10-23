-- 556 — L'IA apprend des mails ENVOYÉS d'Oïhan (22/10/2026).
-- 1. STYLE : profil d'écriture par registre (voyageurs FR/EN/ES, propriétaires, prestataires, équipe) + petits exemples
--    anonymisés → ga_agency_config.style_profil_mail, lu par les brouillons de l'assistant mail et par l'IA voyageurs.
-- 2. SAVOIR : propositions de fiches tirées de ses réponses → ga_mined_fact (origine 'mail', candidate), dans le circuit de
--    relecture existant (« 🧠 Faits à relire ») ; rien n'entre dans le Savoir sans clic. Faits internes (procédures
--    propriétaires, prestataires) → scope 'interne', jamais lus par l'IA voyageurs.
-- Corpus : mail_apprentissage ne garde QUE le texte d'Oïhan, ANONYMISÉ (noms, téléphones, e-mails, adresses, IBAN, montants,
-- codes) ; les mails personnels / sensibles / transferts sont comptés (motif) sans aucun texte. Jamais de pièce jointe.
-- Lecture : service_role seulement (API mail-assistant, titulaire de la boîte). Purge à 5 ans (anonymise_le / date).

create table if not exists public.mail_apprentissage (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.powerhouse_imap_accounts(id) on delete cascade,
  cle text not null,                         -- empreinte sha256 du Message-ID (jamais l'identifiant en clair)
  date timestamptz,
  registre text,                             -- voyageur_fr | voyageur_en | voyageur_es | voyageur_autre | proprietaire | prestataire | equipe | autre_pro
  langue text,
  dest_label text,                           -- destinataire anonymisé (« propriétaire P-3f2a »)
  bien_id uuid references public.bien(id) on delete set null,
  sujet_anonyme text,
  texte_anonyme text,                        -- texte d'Oïhan seul, anonymisé ; null si exclu
  longueur integer,
  exclu text,                                -- personnel | sensible | transfert | automatique | service | vide | fuite_anonymisation
  savoir_faits jsonb,                        -- cache : faits extraits par l'IA (null = pas encore analysé)
  savoir_le timestamptz,
  source text not null default 'boite' check (source in ('boite', 'synchro')),
  cree_le timestamptz not null default now(),
  unique (account_id, cle),
  constraint mail_apprentissage_registre_check check (registre is null or registre in ('voyageur_fr','voyageur_en','voyageur_es','voyageur_autre','proprietaire','prestataire','equipe','autre_pro')),
  constraint mail_apprentissage_texte_ou_exclu check ((exclu is null) = (texte_anonyme is not null))
);
create index if not exists mail_apprentissage_compte_date on public.mail_apprentissage (account_id, date desc);
create index if not exists mail_apprentissage_savoir on public.mail_apprentissage (account_id) where savoir_le is null and exclu is null;
alter table public.mail_apprentissage enable row level security;
revoke all on public.mail_apprentissage from anon, authenticated;

-- État de l'apprentissage par boîte (curseurs, dépenses, dernier passage, arrêt plafond)
alter table public.powerhouse_imap_accounts add column if not exists apprentissage jsonb not null default '{}'::jsonb;

-- Profil de style appris des mails (par registre) : lu par l'assistant mail et l'IA voyageurs
alter table public.ga_agency_config add column if not exists style_profil_mail jsonb;

-- Journal des coûts : objets « apprentissage_* » (n'entrent PAS dans le budget/jour du tri)
alter table public.mail_ia_journal drop constraint if exists mail_ia_journal_objet_check;
alter table public.mail_ia_journal add constraint mail_ia_journal_objet_check check (objet in ('tri', 'brouillon', 'apprentissage_style', 'apprentissage_savoir', 'apprentissage_synthese'));

-- Propositions de Savoir : origine + mails sources (date, destinataire anonymisé) ; scope 'interne' (jamais lu par l'IA voyageurs)
alter table public.ga_mined_fact add column if not exists origine text not null default 'conversation';
alter table public.ga_mined_fact drop constraint if exists ga_mined_fact_origine_check;
alter table public.ga_mined_fact add constraint ga_mined_fact_origine_check check (origine in ('conversation', 'mail'));
alter table public.ga_mined_fact add column if not exists sources jsonb not null default '[]'::jsonb;
alter table public.ga_mined_fact drop constraint if exists ga_mined_fact_scope_check;
alter table public.ga_mined_fact add constraint ga_mined_fact_scope_check check (scope in ('property', 'policy', 'destination', 'interne'));
create index if not exists ga_mined_fact_origine_mail on public.ga_mined_fact (status) where origine = 'mail';

-- Purge : corpus de plus de 5 ans (même règle que l'anonymisation des conversations)
create or replace function public.mail_apprentissage_purge() returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.mail_apprentissage where date < now() - interval '5 years' returning 1) select count(*)::int from d;
$$;
revoke all on function public.mail_apprentissage_purge() from public, anon, authenticated;
grant execute on function public.mail_apprentissage_purge() to service_role;
