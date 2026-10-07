-- 351 — Statut de location d'un bien (08/10/2026, Oïhan) : « on doit pouvoir masquer sans mettre en sourdine ».
-- Oïhan avait mis 56 biens en sourdine (muted) dans Hospitable pour désencombrer le planning ; effet de bord :
-- plus aucune synchro API (réservations, fiche, équipements) pour ces biens. On filtre désormais chez nous :
--   statut_location = 'saisonnier'    → disponible à la location (affiché par défaut)
--                   = 'lld'           → bail étudiant / mobilité en cours (table etudiant)
--                   = 'hors_location' → bien.hors_location (manuel : plus géré, pause) ou non listé
-- Recalculé par trigger (etudiant, bien) et chaque nuit (les baux commencent / finissent avec les dates).
-- PowerHouse : 📆 Calendrier filtre « 🏖 En location » par défaut, hub Biens affiche le statut.

alter table public.bien
  add column if not exists hors_location boolean not null default false,
  add column if not exists statut_location text not null default 'saisonnier'
    check (statut_location in ('saisonnier', 'lld', 'hors_location'));
comment on column public.bien.hors_location is 'Manuel : bien masqué des vues « en location » (plus géré, pause propriétaire…). Migration 351.';
comment on column public.bien.statut_location is 'saisonnier / lld / hors_location — calculé (maj_statut_location), ne pas écrire à la main. Migration 351.';

create or replace function public.maj_statut_location(p_bien uuid default null)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  update bien b set statut_location = s.statut
    from (select b2.id,
            case when b2.hors_location or not coalesce(b2.listed, false) then 'hors_location'
                 when exists (select 1 from etudiant e where e.bien_id = b2.id and not coalesce(e.archived, false)
                                and e.date_entree <= current_date
                                and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, 'infinity'::date) > current_date) then 'lld'
                 else 'saisonnier' end statut
            from bien b2 where p_bien is null or b2.id = p_bien) s
   where s.id = b.id and b.statut_location is distinct from s.statut;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.maj_statut_location(uuid) from public, anon, authenticated;

create or replace function public.trg_statut_location_etudiant()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op <> 'INSERT' then perform maj_statut_location(old.bien_id); end if;
  if tg_op <> 'DELETE' and new.bien_id is not null then perform maj_statut_location(new.bien_id); end if;
  return null;
end $function$;
drop trigger if exists trg_statut_location_etudiant on public.etudiant;
create trigger trg_statut_location_etudiant after insert or update or delete on public.etudiant
  for each row execute function public.trg_statut_location_etudiant();

create or replace function public.trg_statut_location_bien()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  perform maj_statut_location(new.id);
  return null;
end $function$;
drop trigger if exists trg_statut_location_bien on public.bien;
create trigger trg_statut_location_bien after insert or update of hors_location, listed on public.bien
  for each row execute function public.trg_statut_location_bien();
revoke all on function public.trg_statut_location_etudiant() from public, anon, authenticated;
revoke all on function public.trg_statut_location_bien() from public, anon, authenticated;

-- Biens plus gérés (connus) : masqués
update public.bien set hors_location = true where code in ('BACALAN', 'ARREBA', 'MARNEKO');

select public.maj_statut_location();
select cron.schedule('statut-location-biens', '5 22 * * *', $$select public.maj_statut_location()$$);
