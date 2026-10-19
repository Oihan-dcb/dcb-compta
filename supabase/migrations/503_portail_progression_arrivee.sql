-- 503 — Suivi de l'arrivée en temps réel (guide d'arrivée du portail voyageur, 19/10/2026, cadre RGPD validé par Oïhan).
--
-- Une ligne par lien de portail (= une réservation) : étape ouverte + horodatage, parcours choisi, « Je suis bien arrivé ».
-- Données MINIMALES : aucune géolocalisation, aucune adresse IP, aucun appareil ; seulement pour la réservation du lien,
-- seulement quand le voyageur a vérifié son identité (le guide n'est visible qu'après) et jamais en aperçu équipe.
-- Finalité : assistance à l'arrivée et organisation (ménage, accueil) — intérêt légitime ; mention dans le guide.
-- Conservation : supprimé 30 jours après le départ (cron purge-portail-voyageur-journal).
-- Lecture : staff PowerHouse (RLS) pour l'affichage en direct (Realtime) ; écriture : service seulement (api/sejour.js).

create table if not exists public.portail_voyageur_progression (
  lien_id       uuid primary key references public.portail_voyageur_lien(id) on delete cascade,
  reservation_id uuid,
  bien_id       uuid,
  depart_date   date,
  etape_id      text,
  etape_titre   text,
  section       text,
  etape_n       integer,
  etape_total   integer,
  etape_depuis  timestamptz,
  parcours      text,
  parcours_lib  text,
  arrive_le     timestamptz,
  evenements    jsonb not null default '[]'::jsonb,   -- [{le, e: etape|parcours|arrive, v}] (40 au plus)
  maj_le        timestamptz not null default now()
);
comment on table public.portail_voyageur_progression is 'Progression du voyageur dans le guide d''arrivée (étape, parcours, « bien arrivé ») — sans géolocalisation ni IP ; purge 30 j après le départ (503).';
create index if not exists portail_voyageur_progression_resa on public.portail_voyageur_progression (reservation_id);
alter table public.portail_voyageur_progression enable row level security;
drop policy if exists progression_lecture_staff on public.portail_voyageur_progression;
create policy progression_lecture_staff on public.portail_voyageur_progression for select to authenticated using (public.auth_user_is_staff());
do $$ begin
  alter publication supabase_realtime add table public.portail_voyageur_progression;
exception when duplicate_object then null; end $$;

-- Purge : progression 30 jours après le départ, dans le job existant.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'purge-portail-voyageur-journal'),
  command := $cmd$
  delete from public.portail_voyageur_consultation where le < now() - interval '12 months';
  delete from public.portail_voyageur_evenement where le < now() - interval '12 months';
  delete from public.portail_voyageur_code where cree_le < now() - interval '12 months';
  delete from public.portail_voyageur_session where least(coalesce(revoque_le, expire_le), expire_le) < now() - interval '12 months';
  delete from public.portail_voyageur_progression where depart_date < current_date - 30;
$cmd$);
