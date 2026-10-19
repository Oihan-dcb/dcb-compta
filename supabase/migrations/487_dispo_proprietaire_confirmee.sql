-- 487 — Disponibilités confirmées par le propriétaire (19/10/2026, demande Oïhan : « ferme tout et demande confirmation
-- des dates de dispo aux proprios »).
--
-- Principe : pour un bien « soumis à confirmation » (dispo_proprio_bien.exige), la vente directe (dcb-planning
-- api/_direct.js via api/_dispoProprio.js) ne vend QUE les nuits comprises dans une période « louable » confirmée par le
-- propriétaire (en plus du calendrier Hospitable et de la saison 459). Tant qu'il n'a pas répondu : rien de vendable en
-- direct. Le propriétaire répond dans SON portail (dcb-portail-owner, page « Mes disponibilités », même connexion par
-- code e-mail que le reste du portail) via un lien unique par bien et par année (jeton aléatoire : seule son empreinte
-- SHA-256 est stockée), expirant. Rien n'est écrit dans Hospitable : les périodes confirmées deviennent des tâches
-- « Ouvrir dans Hospitable du … au … » dans Accueil › À faire (dcb-planning api/_aFaire.js).
--
--   dispo_proprio_bien       : bien soumis à confirmation (« fermé jusqu'à confirmation »).
--   dispo_proprio_demande    : une demande par bien et par année (préparée → demandée → répondue ; expirée / annulée).
--   dispo_proprio_periode    : périodes déclarées (louable / occupe ; fin = dernière NUIT), versionnées (actif / remplace_le),
--                              suivi de l'ouverture / fermeture faite à la main dans Hospitable.
--   dispo_proprio_historique : journal (préparation, lien, ouverture du lien, réponse, modification, expiration…).
-- RLS : staff seulement (auth_user_is_staff) ; le portail propriétaire et PowerHouse passent par leurs API service_role.

create table if not exists public.dispo_proprio_bien (
  bien_id    uuid primary key references public.bien(id) on delete cascade,
  exige      boolean not null default true,
  depuis     timestamptz not null default now(),
  par        text,
  motif      text,
  maj_le     timestamptz not null default now()
);
comment on table public.dispo_proprio_bien is
  'Bien soumis à la confirmation des disponibilités par le propriétaire (487). exige = true : la vente directe ne vend que les nuits des périodes « louable » confirmées (rien tant qu''il n''a pas répondu).';

create table if not exists public.dispo_proprio_demande (
  id               uuid primary key default gen_random_uuid(),
  bien_id          uuid not null references public.bien(id) on delete cascade,
  proprietaire_id  uuid references public.proprietaire(id) on delete set null,
  annee            int  not null check (annee between 2025 and 2100),
  statut           text not null default 'preparee' check (statut in ('preparee','demandee','repondue','expiree','annulee')),
  token_hash       text unique,
  token_cree_le    timestamptz,
  expire_le        timestamptz not null,
  langue           text not null default 'fr' check (langue in ('fr','en','es')),
  contexte         jsonb not null default '{}'::jsonb,
  cree_le          timestamptz not null default now(),
  cree_par         text,
  demandee_le      timestamptz,
  demandee_par     text,
  mail_envoye_le   timestamptz,
  nb_relances      int not null default 0,
  relance_le       timestamptz,
  ouverte_le       timestamptz,
  repondue_le      timestamptz,
  repondu_par      text,
  modifiee_le      timestamptz,
  test             boolean not null default false,
  note             text
);
create unique index if not exists dispo_proprio_demande_une_ouverte
  on public.dispo_proprio_demande (bien_id, annee) where statut in ('preparee','demandee','repondue') and not test;
create index if not exists dispo_proprio_demande_bien on public.dispo_proprio_demande (bien_id, annee);
create index if not exists dispo_proprio_demande_proprio on public.dispo_proprio_demande (proprietaire_id);
comment on table public.dispo_proprio_demande is
  'Demande de confirmation des disponibilités d''un bien pour une année (487). Lien = portail propriétaire ?dispos=<jeton> ; seule l''empreinte SHA-256 du jeton est stockée (régénéré à chaque envoi / relance). test = propriétaire fictif (jamais pris en compte par la vente directe).';

create table if not exists public.dispo_proprio_periode (
  id                     uuid primary key default gen_random_uuid(),
  demande_id             uuid not null references public.dispo_proprio_demande(id) on delete cascade,
  bien_id                uuid not null references public.bien(id) on delete cascade,
  debut                  date not null,
  fin                    date not null,
  type                   text not null check (type in ('louable','occupe')),
  actif                  boolean not null default true,
  cree_le                timestamptz not null default now(),
  remplace_le            timestamptz,
  hospitable_ouvert_le   timestamptz,
  hospitable_ouvert_par  text,
  hospitable_ferme_le    timestamptz,
  hospitable_ferme_par   text,
  check (fin >= debut)
);
create index if not exists dispo_proprio_periode_bien on public.dispo_proprio_periode (bien_id, actif, type);
create index if not exists dispo_proprio_periode_demande on public.dispo_proprio_periode (demande_id);
comment on table public.dispo_proprio_periode is
  'Périodes déclarées par le propriétaire (487) : louable = DCB peut louer, occupe = le propriétaire occupe. fin = dernière NUIT. actif=false + remplace_le = version précédente. hospitable_ouvert_le / _ferme_le = fait à la main dans Hospitable (tâche À faire).';

create table if not exists public.dispo_proprio_historique (
  id          bigserial primary key,
  demande_id  uuid references public.dispo_proprio_demande(id) on delete cascade,
  bien_id     uuid references public.bien(id) on delete cascade,
  le          timestamptz not null default now(),
  qui         text,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists dispo_proprio_historique_bien on public.dispo_proprio_historique (bien_id, le desc);

alter table public.dispo_proprio_bien enable row level security;
alter table public.dispo_proprio_demande enable row level security;
alter table public.dispo_proprio_periode enable row level security;
alter table public.dispo_proprio_historique enable row level security;
drop policy if exists dispo_proprio_bien_staff on public.dispo_proprio_bien;
create policy dispo_proprio_bien_staff on public.dispo_proprio_bien for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());
drop policy if exists dispo_proprio_demande_staff on public.dispo_proprio_demande;
create policy dispo_proprio_demande_staff on public.dispo_proprio_demande for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());
drop policy if exists dispo_proprio_periode_staff on public.dispo_proprio_periode;
create policy dispo_proprio_periode_staff on public.dispo_proprio_periode for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());
drop policy if exists dispo_proprio_historique_staff on public.dispo_proprio_historique;
create policy dispo_proprio_historique_staff on public.dispo_proprio_historique for all to authenticated
  using (auth_user_is_staff()) with check (auth_user_is_staff());

-- « Ferme tout » (Oïhan 19/10/2026) : GASQ, B16, B24, DUL + résidences principales CERES, EKIA, MUNDUZ, ERDIGUNEA.
insert into public.dispo_proprio_bien (bien_id, exige, par, motif)
select id, true, 'claude — 19/10/2026', 'Fermé jusqu''à confirmation des disponibilités 2027 par le propriétaire (demande Oïhan 19/10/2026)'
from public.bien where code in ('GASQ','B16','B24','DUL','CERES','EKIA','MUNDUZ','ERDIGUNEA')
on conflict (bien_id) do nothing;
