-- 359 — Les locations étudiantes saisies dans Hospitable (08/10/2026, Oïhan : « FOLLE je vois une résa étudiante mais
-- faite comme une résa owner ») : convention de l'équipe = réservation MANUELLE longue au nom « Etudiant(e) … »,
-- souvent en séjour propriétaire pour bloquer le calendrier. Tous les baux ne sont pas dans Gestion → Loc. longues
-- (B16, B24, DUL : étudiants gérés par le propriétaire ; FOLLE 2026-27, DUL2 2025-26 : pas saisis).
-- Désormais une telle réservation compte comme location étudiante :
--   · conformité saisonnier (bien_bail_etudiant_annee) ;
--   · statut « lld » du bien pendant le séjour (maj_statut_location).
-- Critère : platform = manual, acceptée, ≥ 60 nuits, nom commençant par « étudiant / etudiant / edutiant » (faute vue).
create or replace function public.resa_est_etudiant(p_platform text, p_guest text, p_arrivee date, p_depart date)
 returns boolean language sql immutable as $$
  select coalesce(p_platform, '') = 'manual' and (p_depart - p_arrivee) >= 60
     and lower(coalesce(p_guest, '')) ~ '^\s*(é|e)tudiant|^\s*edutiant'
$$;

create or replace function public.bien_bail_etudiant_annee(p_bien uuid, p_annee int)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from etudiant e
                  where e.bien_id = p_bien and coalesce(e.type_bail, 'etudiant') = 'etudiant'
                    and e.date_entree < make_date(p_annee + 1, 1, 1)
                    and coalesce(e.date_sortie_reelle, e.date_sortie_prevue,
                                 case when coalesce(e.archived, false) then e.date_entree else 'infinity'::date end) >= make_date(p_annee, 1, 1))
      or exists (select 1 from reservation r
                  where r.bien_id = p_bien and r.final_status = 'accepted'
                    and resa_est_etudiant(r.platform, r.guest_name, r.arrival_date, r.departure_date)
                    and r.arrival_date < make_date(p_annee + 1, 1, 1) and r.departure_date > make_date(p_annee, 1, 1))
      or exists (select 1 from bien b where b.id = p_bien and b.hors_location and b.hors_location_motif = 'etudiant_hors_dcb'
                    and p_annee = extract(year from current_date)::int)
$$;
revoke all on function public.bien_bail_etudiant_annee(uuid, int) from public, anon;

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
                 when exists (select 1 from etudiant e where e.bien_id = b2.id and not coalesce(e.archived, false)
                                and e.date_entree <= current_date
                                and coalesce(e.date_sortie_reelle, e.date_sortie_prevue, 'infinity'::date) > current_date) then 'lld'
                 when bien_bail_mobilite_en_cours(b2.id) then 'lld'
                 when exists (select 1 from reservation r where r.bien_id = b2.id and r.final_status = 'accepted'
                                and resa_est_etudiant(r.platform, r.guest_name, r.arrival_date, r.departure_date)
                                and r.arrival_date <= current_date and r.departure_date > current_date) then 'lld'
                 when b2.hors_location then 'hors_location'
                 when b2.hospitable_etat = 'muted' then 'hors_location'
                 else 'saisonnier' end statut
            from bien b2 where p_bien is null or b2.id = p_bien) s
   where s.id = b.id and b.statut_location is distinct from s.statut;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.maj_statut_location(uuid) from public, anon, authenticated;
select public.maj_statut_location();

-- Bascule de retour en saisonnier aussi à la fin de ces séjours étudiants Hospitable (si le bail n'est pas déjà
-- suivi dans Loc. longues, qui crée sa propre bascule) — même fonction que les baux mobilité.
create or replace function public.bascules_mobilite_planifier()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int; m int;
begin
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule, note)
  select distinct r.bien_id, null::uuid, 'vers_saisonnier', r.departure_date, 'Fin de bail mobilité (' || coalesce(r.code, rc.reservation_id) || ')'
    from rental_contracts rc
    join reservation r on rc.reservation_id in (r.code, r.hospitable_id, r.id::text)
    join bien b on b.id = r.bien_id
   where rc.type_contrat = 'mobilite' and rc.statut = 'signed' and r.final_status = 'accepted'
     and r.departure_date >= current_date - 1
     and coalesce(b.type_exploitation, '') not in ('mobilite', 'location_annee')
  on conflict (bien_id, sens, date_bascule) where etudiant_id is null do nothing;
  get diagnostics n = row_count;
  insert into bascule_bien (bien_id, etudiant_id, sens, date_bascule, note)
  select distinct r.bien_id, null::uuid, 'vers_saisonnier', r.departure_date, 'Fin de location étudiante (' || coalesce(r.code, '') || ', ' || r.guest_name || ')'
    from reservation r join bien b on b.id = r.bien_id
   where r.final_status = 'accepted' and resa_est_etudiant(r.platform, r.guest_name, r.arrival_date, r.departure_date)
     and r.departure_date >= current_date - 1
     and coalesce(b.type_exploitation, '') not in ('mobilite', 'location_annee')
     and not exists (select 1 from bascule_bien x where x.bien_id = r.bien_id and x.sens = 'vers_saisonnier'
                       and abs(x.date_bascule - r.departure_date) <= 15 and x.statut <> 'annulee')
  on conflict (bien_id, sens, date_bascule) where etudiant_id is null do nothing;
  get diagnostics m = row_count;
  return n + m;
end $function$;
revoke all on function public.bascules_mobilite_planifier() from public, anon, authenticated;
select public.bascules_mobilite_planifier();

-- Pré-remplissage : biens sans type ayant une location étudiante Hospitable → mixte (DUL, 08/10/2026)
update public.bien b set type_exploitation = 'mixte_etudiant_saisonnier'
 where type_exploitation is null and exists (select 1 from reservation r where r.bien_id = b.id and r.final_status = 'accepted'
   and resa_est_etudiant(r.platform, r.guest_name, r.arrival_date, r.departure_date));
-- PAITOU = mobilité uniquement (Oïhan 08/10/2026) → sa bascule de retour en saisonnier du 15/10 est annulée
update public.bien set type_exploitation = 'mobilite' where code = 'PAITOU';
select public.bascules_exclure_types_sans_saisonnier();
