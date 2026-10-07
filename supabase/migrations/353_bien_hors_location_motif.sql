-- 353 — Masquer un bien avec motif et date de retour (08/10/2026, Oïhan : « B16 apparaît en location alors
-- qu'il est loué par un étudiant, idem B24 ; AUREAN est bloqué ; ITS, le proprio est rentré dedans jusqu'à la
-- saison prochaine — il faut un moyen de cacher »). Ces cas ne passent pas par nos baux (table etudiant).
--   hors_location_motif : etudiant_hors_dcb (bail géré par le proprio → statut « lld ») · proprio_occupe ·
--                         bloque · plus_gere · autre
--   hors_location_jusqu_au : date de retour en location (NULL = indéfini). À cette date, le bien redevient
--                         « saisonnier » tout seul (cron 0h05) et une bascule vers_saisonnier est créée →
--                         visible à J-30 dans 🔁 Bascules, restock complet au sac à J-7 (migration 350).
-- + Oïhan 08/10 : « tous les biens que j'ai mutés, c'est parce qu'en ce moment ils ne sont plus réservables » →
--   un bien EN SOURDINE dans Hospitable (bien.hospitable_etat = 'muted', contrôle quotidien
--   hospitable-etat-biens, migration 352) est automatiquement « hors location » (sauf bail DCB en cours → lld).
--   La sourdine reste son geste unique ; PowerHouse suit.
alter table public.bien
  add column if not exists hors_location_motif text
    check (hors_location_motif in ('etudiant_hors_dcb', 'proprio_occupe', 'bloque', 'plus_gere', 'autre')),
  add column if not exists hors_location_jusqu_au date;
comment on column public.bien.hors_location_motif is 'Motif du masquage manuel (hors_location). etudiant_hors_dcb → statut lld. Migration 353.';
comment on column public.bien.hors_location_jusqu_au is 'Date de retour en location : le masquage tombe tout seul à cette date. Migration 353.';

-- Bascules sans bail DCB : etudiant_id facultatif, une bascule « manuelle » par bien et date
alter table public.bascule_bien alter column etudiant_id drop not null;
create unique index if not exists bascule_bien_manuelle_uniq on public.bascule_bien (bien_id, sens, date_bascule) where etudiant_id is null;

create or replace function public.maj_statut_location(p_bien uuid default null)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  -- 1. masquages arrivés à échéance : le bien revient en location
  update bien set hors_location = false, hors_location_motif = null, hors_location_jusqu_au = null
   where hors_location and hors_location_jusqu_au is not null and hors_location_jusqu_au <= current_date
     and (p_bien is null or id = p_bien);
  -- 2. bascule de retour pour les masquages datés (sauf « plus géré »)
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule, note)
  select b.id, null, 'vers_saisonnier', b.hors_location_jusqu_au,
         'Fin de masquage (' || coalesce(b.hors_location_motif, 'autre') || ')'
    from bien b
   where b.hors_location and b.hors_location_jusqu_au > current_date and coalesce(b.hors_location_motif, '') <> 'plus_gere'
     and (p_bien is null or b.id = p_bien)
  on conflict do nothing;
  -- 3. statut
  update bien b set statut_location = s.statut
    from (select b2.id,
            case when not coalesce(b2.listed, false) then 'hors_location'
                 when b2.hors_location and b2.hors_location_motif = 'etudiant_hors_dcb' then 'lld'
                 when b2.hors_location then 'hors_location'
                 when exists (select 1 from etudiant e where e.bien_id = b2.id and not coalesce(e.archived, false)
                                and e.date_entree <= current_date
                                and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, 'infinity'::date) > current_date) then 'lld'
                 when b2.hospitable_etat = 'muted' then 'hors_location'
                 else 'saisonnier' end statut
            from bien b2 where p_bien is null or b2.id = p_bien) s
   where s.id = b.id and b.statut_location is distinct from s.statut;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.maj_statut_location(uuid) from public, anon, authenticated;

drop trigger if exists trg_statut_location_bien on public.bien;
create trigger trg_statut_location_bien after insert or update of hors_location, hors_location_motif, hors_location_jusqu_au, listed, hospitable_etat on public.bien
  for each row execute function public.trg_statut_location_bien();

-- Les cas signalés par Oïhan le 08/10/2026 (dates de retour à compléter dans la fiche du bien)
update public.bien set hors_location = true, hors_location_motif = 'etudiant_hors_dcb' where code in ('B16', 'B24');
update public.bien set hors_location = true, hors_location_motif = 'bloque' where code = 'AUREAN';
update public.bien set hors_location = true, hors_location_motif = 'proprio_occupe' where code = 'ITS';
update public.bien set hors_location_motif = 'plus_gere' where code in ('BACALAN', 'ARREBA', 'MARNEKO');
