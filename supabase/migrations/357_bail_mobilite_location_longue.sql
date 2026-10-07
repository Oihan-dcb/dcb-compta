-- 357 — Les baux mobilité SIGNÉS (rental_contracts.type_contrat = 'mobilite', PowerHouse) comptent comme location
-- longue (08/10/2026, Oïhan : « PATXI cette année il est en mobilité car on n'a pas trouvé d'étudiant »).
-- Avant : seuls les baux de la table etudiant (Gestion → Loc. longues) mettaient un bien en « lld » → PATXI
-- (bail mobilité 8B2SOT, 01/10 → 04/11/2026) apparaissait « en location ».
-- rental_contracts.reservation_id contient le CODE de la résa (ex. 8B2SOT), d'où la jointure sur code/hospitable_id/id (357b).
--   · maj_statut_location : bail mobilité signé couvrant aujourd'hui → 'lld' ;
--   · bascules_planifier : bascule vers_saisonnier à la fin du bail mobilité (etudiant_id NULL, note) →
--     🔁 Bascules à J-30, restock au sac à J-7, battement 2 j (PowerHouse 37c).
create or replace function public.bien_bail_mobilite_en_cours(p_bien uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from rental_contracts rc
                   join reservation r on rc.reservation_id in (r.code, r.hospitable_id, r.id::text)
                  where r.bien_id = p_bien and rc.type_contrat = 'mobilite' and rc.statut = 'signed'
                    and r.final_status = 'accepted' and r.arrival_date <= current_date and r.departure_date > current_date)
$$;
revoke all on function public.bien_bail_mobilite_en_cours(uuid) from public, anon, authenticated;

create or replace function public.maj_statut_location(p_bien uuid default null)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  update bien set hors_location = false, hors_location_motif = null, hors_location_jusqu_au = null
   where hors_location and hors_location_jusqu_au is not null and hors_location_jusqu_au <= current_date
     and (p_bien is null or id = p_bien);
  update bascule_bien bb set statut = 'annulee', updated_at = now()
    from bien b
   where b.id = bb.bien_id and bb.etudiant_id is null and bb.statut = 'prevue' and bb.date_bascule > current_date
     and coalesce(bb.note, '') like 'Fin de masquage%'
     and (not b.hors_location or b.hors_location_jusqu_au is distinct from bb.date_bascule)
     and (p_bien is null or b.id = p_bien);
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule, note)
  select b.id, null, 'vers_saisonnier', b.hors_location_jusqu_au,
         'Fin de masquage (' || coalesce(b.hors_location_motif, 'autre') || ')'
    from bien b
   where b.hors_location and b.hors_location_jusqu_au > current_date and coalesce(b.hors_location_motif, '') <> 'plus_gere'
     and (p_bien is null or b.id = p_bien)
  on conflict (bien_id, sens, date_bascule) where etudiant_id is null do update set statut = 'prevue', updated_at = now()
    where bascule_bien.statut = 'annulee';
  update bien b set statut_location = s.statut
    from (select b2.id,
            case when not coalesce(b2.listed, false) then 'hors_location'
                 when b2.hors_location and b2.hors_location_motif = 'etudiant_hors_dcb' then 'lld'
                 when b2.hors_location then 'hors_location'
                 when exists (select 1 from etudiant e where e.bien_id = b2.id and not coalesce(e.archived, false)
                                and e.date_entree <= current_date
                                and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, 'infinity'::date) > current_date) then 'lld'
                 when bien_bail_mobilite_en_cours(b2.id) then 'lld'
                 when b2.hospitable_etat = 'muted' then 'hors_location'
                 else 'saisonnier' end statut
            from bien b2 where p_bien is null or b2.id = p_bien) s
   where s.id = b.id and b.statut_location is distinct from s.statut;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.maj_statut_location(uuid) from public, anon, authenticated;

-- Bascules de fin de bail mobilité (ajoutées avant le traitement J-7 de bascules_planifier)
create or replace function public.bascules_mobilite_planifier()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule, note)
  select distinct r.bien_id, null::uuid, 'vers_saisonnier', r.departure_date, 'Fin de bail mobilité (' || coalesce(r.code, rc.reservation_id) || ')'
    from rental_contracts rc
    join reservation r on rc.reservation_id in (r.code, r.hospitable_id, r.id::text)
   where rc.type_contrat = 'mobilite' and rc.statut = 'signed' and r.final_status = 'accepted'
     and r.bien_id is not null and r.departure_date >= current_date - 1
  on conflict (bien_id, sens, date_bascule) where etudiant_id is null do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.bascules_mobilite_planifier() from public, anon, authenticated;
select cron.unschedule('bascules-lld-saisonnier');
select cron.schedule('bascules-lld-saisonnier', '5 6 * * *', $$select public.bascules_mobilite_planifier(); select public.bascules_planifier()$$);
-- statut recalculé chaque nuit (cron statut-location-biens) ; maintenant :
select public.bascules_mobilite_planifier();
select public.maj_statut_location();
