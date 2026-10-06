-- 335 — Séjour propriétaire « sans ménage » : vérification sur le BIEN, pas seulement les missions rattachées
-- (06/10/2026). CERES RMPZBP (16→24/08) : ménages rattachés annulés, mais le ménage a bien été fait le
-- 02/09 par Clémence sous une tâche « Maintenance » non rattachée au séjour (confirmé par Oïhan).
-- Règle : menage_proprio_annule = séjour propriétaire dont les missions rattachées existent et sont
-- toutes annulées ET aucune mission active (ni annulée ni refusée) sur le bien entre son départ et
-- l'arrivée suivante (plafond départ + 14 jours).
create or replace function public.maj_menage_proprio(p_resa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r reservation; v_nb int; v_actives int; v_fin date; v_autre int; v_flag boolean;
begin
  if p_resa_id is null then return; end if;
  select * into r from reservation where id = p_resa_id;
  if r.id is null or r.owner_stay is not true then return; end if;
  select count(*), count(*) filter (where statut not in ('cancelled', 'refuse')) into v_nb, v_actives
    from mission_menage where reservation_id = p_resa_id;
  select least(coalesce(min(n.arrival_date), r.departure_date + 14), r.departure_date + 14) into v_fin
    from reservation n
   where n.bien_id = r.bien_id and n.id <> r.id and n.arrival_date >= r.departure_date
     and n.final_status not in ('cancelled', 'not accepted expired', 'declined', 'not accepted');
  select count(*) into v_autre from mission_menage m
   where m.bien_id = r.bien_id and m.date_mission between r.departure_date and v_fin
     and m.statut not in ('cancelled', 'refuse') and m.reservation_id is distinct from p_resa_id;
  v_flag := v_nb > 0 and v_actives = 0 and v_autre = 0;
  update reservation set menage_proprio_annule = v_flag where id = p_resa_id and menage_proprio_annule is distinct from v_flag;
end $$;

-- Une mission créée / modifiée sur un bien peut changer le statut des séjours propriétaire qui la précèdent.
create or replace function public.trg_maj_menage_proprio()
returns trigger language plpgsql security definer set search_path = public as $$
declare x record;
begin
  perform maj_menage_proprio(new.reservation_id);
  if tg_op = 'UPDATE' and old.reservation_id is distinct from new.reservation_id then perform maj_menage_proprio(old.reservation_id); end if;
  for x in select id from reservation
            where bien_id = new.bien_id and owner_stay is true
              and departure_date between new.date_mission - 14 and new.date_mission loop
    perform maj_menage_proprio(x.id);
  end loop;
  return new;
exception when others then return new; end $$;
drop trigger if exists trg_maj_menage_proprio on public.mission_menage;
create trigger trg_maj_menage_proprio after insert or update of statut, reservation_id, date_mission, bien_id on public.mission_menage
  for each row execute function public.trg_maj_menage_proprio();

select maj_menage_proprio(id) from reservation where owner_stay is true;
