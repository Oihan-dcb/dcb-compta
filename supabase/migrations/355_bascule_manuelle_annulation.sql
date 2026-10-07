-- 355 — Bascule de retour « manuelle » (masquage daté, migration 353) annulée si le masquage est levé ou
-- redaté avant l'échéance (sinon une ligne fantôme resterait dans 🔁 Bascules et préparerait un sac à J-7).
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
                 when b2.hospitable_etat = 'muted' then 'hors_location'
                 else 'saisonnier' end statut
            from bien b2 where p_bien is null or b2.id = p_bien) s
   where s.id = b.id and b.statut_location is distinct from s.statut;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.maj_statut_location(uuid) from public, anon, authenticated;
