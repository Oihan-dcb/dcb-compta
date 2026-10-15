-- 434 — Purge automatique des pièces d'identité et selfies des voyageurs (décision d'Oïhan 15/10/2026)
--
-- Le contrat promet la suppression des documents d'identité ; aucune purge n'existait. Le délai appliqué est celui
-- que le contrat SIGNÉ de chaque voyageur promet, lu dans son texte rendu (rental_contracts.contenu_html_rendered) :
--   • « conservés pendant 1 an à compter de la fin du séjour, puis supprimés » (FR v3 / Lauïan FR)
--       → selfie + pièce d'identité : purgeables à partir de départ + 1 an + 1 jour         (regle 'contrat_1_an')
--   • « La photo d'identité est conservée pendant la durée du séjour puis supprimée dans un délai de 30 jours »
--     (FR v1/v2, tous les modèles EN et ES : « deleted within 30 days » / « se elimina en un plazo de 30 días »)
--       → selfie : purgeable à partir de départ + 30 jours                                   (regle 'contrat_30_jours')
--       → pièce d'identité (non mentionnée par ce texte) : règle d'Oïhan / politique, départ + 1 an + 1 jour
--                                                                                             (regle 'defaut_1_an')
--   • aucun de ces textes (contrats de test, rendu absent) → départ + 1 an + 1 jour          (regle 'defaut_1_an')
-- Jamais rien sans date de départ, ni avant la fin du séjour. Les fichiers sont supprimés par l'API Storage
-- (PowerHouse api/cron-purge-identite.js) — jamais de DELETE SQL sur storage.objects — puis la colonne de chemin
-- est vidée. Mandats propriétaires, baux mobilité, onboarding propriétaire / AE : NON purgés (aucun délai promis).
--
-- Journal non personnel : type de pièce, id du dossier (session de signature), contrat, règle, dates.

create table if not exists public.identite_purge_journal (
  id               bigserial primary key,
  purged_at        timestamptz not null default now(),
  dossier_type     text not null default 'contrat_voyageur',
  dossier_id       uuid not null,            -- contract_sign_sessions.id
  contract_id      uuid,
  piece            text not null check (piece in ('selfie', 'piece_identite')),
  regle            text not null,
  date_fin_sejour  date,
  echeance         date,                     -- premier jour où la suppression était permise
  resultat         text not null default 'supprime' check (resultat in ('supprime', 'fichier_absent', 'erreur')),
  erreur           text
);
create index if not exists identite_purge_journal_dossier_idx on public.identite_purge_journal (dossier_id);
alter table public.identite_purge_journal enable row level security;
drop policy if exists identite_purge_journal_staff_lecture on public.identite_purge_journal;
create policy identite_purge_journal_staff_lecture on public.identite_purge_journal
  for select to authenticated using (exists (select 1 from public.staff_users s where s.auth_user_id = auth.uid()));
comment on table public.identite_purge_journal is 'Trace non personnelle des purges de selfies / pièces d''identité voyageurs (434). Écrit par PowerHouse api/cron-purge-identite.js (service_role).';

-- Candidats à la purge au jour p_jour (lecture seule). Une ligne par fichier.
create or replace function public.identite_purge_candidats(p_jour date default current_date)
returns table (dossier_id uuid, contract_id uuid, piece text, chemin text, regle text, date_fin_sejour date, echeance date)
language sql stable security definer set search_path to 'public' as $$
  with s as (
    select cs.id, cs.contract_id, cs.identity_photo_url, cs.id_document_url,
           nullif(rc.sejour_snapshot->>'date_depart', '')::date as dep,
           case
             when rc.contenu_html_rendered ~ 'conservés pendant <strong>1 an</strong> à compter de la fin du séjour' then '1an'
             when rc.contenu_html_rendered ~ '(supprimée dans un délai de 30 jours|deleted within 30 days|se elimina en un plazo de 30 d)' then '30j'
             else 'aucun'
           end as promesse
      from contract_sign_sessions cs
      join rental_contracts rc on rc.id = cs.contract_id
     where (nullif(trim(cs.identity_photo_url), '') is not null or nullif(trim(cs.id_document_url), '') is not null)
       and rc.sejour_snapshot->>'date_depart' ~ '^\d{4}-\d{2}-\d{2}$'
  ), l as (
    select id, contract_id, 'selfie'::text as piece, trim(identity_photo_url) as chemin, dep,
           case promesse when '1an' then 'contrat_1_an' when '30j' then 'contrat_30_jours' else 'defaut_1_an' end as regle,
           case when promesse = '30j' then dep + 30 else (dep + interval '1 year')::date + 1 end as echeance
      from s where nullif(trim(identity_photo_url), '') is not null
    union all
    select id, contract_id, 'piece_identite', trim(id_document_url), dep,
           case promesse when '1an' then 'contrat_1_an' else 'defaut_1_an' end,
           (dep + interval '1 year')::date + 1
      from s where nullif(trim(id_document_url), '') is not null
  )
  select id, contract_id, piece, chemin, regle, dep, echeance
    from l
   where dep < p_jour            -- jamais avant la fin du séjour
     and echeance <= p_jour
   order by echeance, id;
$$;
revoke all on function public.identite_purge_candidats(date) from public, anon, authenticated;
grant execute on function public.identite_purge_candidats(date) to service_role;
comment on function public.identite_purge_candidats(date) is 'Selfies / pièces d''identité voyageurs dont le délai promis par le contrat signé est écoulé au jour donné (434). Lecture seule.';
