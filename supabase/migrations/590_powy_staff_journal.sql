-- 590 — 💬 Powy staff (portail AE, 23/10/2026)
-- Journal de chaque échange avec Powy dans le portail AE : question, réponse, actions proposées puis acceptées /
-- refusées, coût. Sert à :
--   • le garde-fou de coût (plafond par AE et global par jour, cache des questions identiques) — lu par
--     dcb-planning api/powy-staff.js avec la clé service ;
--   • la vue PowerHouse « Ce que l'équipe demande à Powy » (👔 Staff) : questions fréquentes, sans réponse,
--     actions refusées, process les plus demandés.
-- Écriture : UNIQUEMENT par l'endpoint serveur (clé service). Lecture : bureau (auth_user_is_staff). Les AE ne lisent
-- pas le journal (ni le leur, ni celui des autres).

create table if not exists public.powy_staff_journal (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  ae_id        uuid not null references public.auto_entrepreneur(id) on delete cascade,
  ae_user_id   uuid,
  question     text not null,
  reponse      text,
  sujet        text,              -- id d'un process (ex. 'menage-depart'), 'appli:<thème formation>' ou 'autre'
  ne_sait_pas  boolean not null default false,
  quiz         boolean not null default false,
  actions      jsonb not null default '[]'::jsonb, -- [{type, …, statut: proposee|acceptee|refusee|echec, detail, at}]
  mission_id   uuid,              -- mission sur laquelle portait la question (si une)
  ecran        text,              -- écran ouvert au moment de la question (jour, missions, outils…)
  cache_cle    text,              -- empreinte question normalisée + contexte (réponse réutilisée si identique)
  cache_hit    boolean not null default false,
  modele       text,
  cout_usd     numeric(10,6),
  tokens_in    integer,
  tokens_out   integer,
  latence_ms   integer,
  erreur       text
);

comment on table public.powy_staff_journal is 'Powy staff (portail AE) : questions, réponses, actions proposées/acceptées, coût. Écrit par dcb-planning api/powy-staff.js (service), lu par le bureau.';

create index if not exists powy_staff_journal_ae_jour on public.powy_staff_journal (ae_id, created_at desc);
create index if not exists powy_staff_journal_jour on public.powy_staff_journal (created_at desc);
create index if not exists powy_staff_journal_cache on public.powy_staff_journal (cache_cle, created_at desc) where cache_cle is not null and erreur is null;

alter table public.powy_staff_journal enable row level security;

drop policy if exists powy_staff_journal_lecture_bureau on public.powy_staff_journal;
create policy powy_staff_journal_lecture_bureau on public.powy_staff_journal
  for select to authenticated using (public.auth_user_is_staff());

revoke all on public.powy_staff_journal from anon;
revoke insert, update, delete on public.powy_staff_journal from authenticated;
grant select on public.powy_staff_journal to authenticated;
