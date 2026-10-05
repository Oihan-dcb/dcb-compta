-- 320 — Extras absorbés par le forfait (05/10/2026, règle Oïhan)
-- « Si l'AE réussit à faire des extras mais respecte la durée du forfait, c'est parfait : pas besoin de
-- refacturer. » La durée prévue (mission_menage.duree_prevue) est le forfait ; seul le temps qui la
-- DÉPASSE est payé et facturé en extra. À la confirmation de la durée (Ma journée), les extras créés
-- PENDANT la mission (entretien hors forfait, extra constaté) sont ramenés à ce dépassement : les plus
-- récents d'abord, annulés (« absorbé dans le forfait ») ou réduits au prorata (montant proportionnel).
-- Les passages d'entretien restent enregistrés (la boucle d'entretien repart). Missions « Maintenance »
-- (hors séjour : les extras SONT le paiement) et missions sans durée prévue : rien n'est touché.
create or replace function public.terrain_ajuster_extras_forfait(p_mission_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m mission_menage; t mission_terrain; x record;
  total int; prevu int; excess int; somme int; a_retirer int; garde int;
begin
  m := _terrain_mission_check(p_mission_id);
  select * into t from mission_terrain where mission_id = m.id;
  if not found or t.ended_at is null then raise exception 'mission_non_terminee'; end if;
  if m.duree_prevue is null or coalesce(m.titre_ical, '') like 'Maintenance%' then
    select coalesce(sum(duree_minutes), 0) into garde from prestation_hors_forfait
     where mission_id = m.id and created_at >= t.started_at and statut not in ('annule', 'refuse', 'cancelled');
    return garde;
  end if;
  total := coalesce(t.duree_corrigee_minutes, t.duree_minutes, 0);
  prevu := round(m.duree_prevue * 60);
  excess := greatest(0, total - prevu);
  select coalesce(sum(duree_minutes), 0) into somme from prestation_hors_forfait
   where mission_id = m.id and created_at >= t.started_at and statut = 'en_attente';
  a_retirer := greatest(0, somme - excess);
  for x in select id, duree_minutes, montant from prestation_hors_forfait
            where mission_id = m.id and created_at >= t.started_at and statut = 'en_attente' and coalesce(duree_minutes, 0) > 0
            order by created_at desc loop
    exit when a_retirer <= 0;
    if a_retirer >= x.duree_minutes then
      update prestation_hors_forfait set statut = 'annule',
        description = coalesce(description, '') || E'\n— absorbé dans le forfait (mission dans la durée prévue)', updated_at = now()
       where id = x.id;
      a_retirer := a_retirer - x.duree_minutes;
    else
      update prestation_hors_forfait set
        duree_minutes = x.duree_minutes - a_retirer,
        montant = round(coalesce(x.montant, 0) * (x.duree_minutes - a_retirer)::numeric / x.duree_minutes),
        description = coalesce(description, '') || E'\n— ramené au dépassement du forfait (' || (x.duree_minutes - a_retirer) || ' min)', updated_at = now()
       where id = x.id;
      a_retirer := 0;
    end if;
  end loop;
  select coalesce(sum(duree_minutes), 0) into garde from prestation_hors_forfait
   where mission_id = m.id and created_at >= t.started_at and statut not in ('annule', 'refuse', 'cancelled');
  return garde;
end $$;
revoke all on function public.terrain_ajuster_extras_forfait(uuid) from public, anon;
grant execute on function public.terrain_ajuster_extras_forfait(uuid) to authenticated;
