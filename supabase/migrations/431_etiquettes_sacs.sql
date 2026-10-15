-- 431 — Outil « 🏷 Étiquettes » (PowerHouse, 15/10/2026)
-- Les étiquettes de préparation (bien_sac_preparation, migration 429b/430) sont la SOURCE DE VÉRITÉ du linge,
-- des produits et des sacs. L'éditeur léger de PowerHouse les corrige directement :
--   1. historique de chaque modification dans fiche_historique (même fonction que bien / proprietaire) ;
--   2. RPC etiquettes_sacs_jour : les sacs à préparer d'un jour (ménages de départ + recouches avec linge),
--      avec la prochaine arrivée (voyageurs), la configuration de couchage retenue et les recouches vendues.

-- 1. Historique ---------------------------------------------------------------------------------------------
drop trigger if exists trg_historique_bien_sac_preparation on public.bien_sac_preparation;
create trigger trg_historique_bien_sac_preparation
  after update on public.bien_sac_preparation
  for each row execute function public.trace_fiche_historique();

-- Création / désactivation tracées aussi (ajout d'une étiquette pour un bien qui n'en avait pas).
create or replace function public.trace_sac_preparation_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.fiche_historique (table_nom, fiche_id, avant, apres, auteur_id, auteur_email)
  values (TG_TABLE_NAME, NEW.id, '{}'::jsonb,
          jsonb_build_object('etiquette', NEW.etiquette, 'sous_etiquette', NEW.sous_etiquette, 'blocs', NEW.blocs, 'regles_pax', NEW.regles_pax, 'bien_id', NEW.bien_id),
          auth.uid(), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');
  return NEW;
end $$;
drop trigger if exists trg_historique_bien_sac_preparation_ins on public.bien_sac_preparation;
create trigger trg_historique_bien_sac_preparation_ins
  after insert on public.bien_sac_preparation
  for each row execute function public.trace_sac_preparation_insert();

-- 2. Sacs du jour --------------------------------------------------------------------------------------------
create or replace function public.etiquettes_sacs_jour(p_date date)
returns table(
  mission_id uuid, date_mission date, heure_mission time, type_mission text, statut text,
  bien_id uuid, code text, ae_prenom text,
  sac_id uuid, etiquette text, sous_etiquette text, blocs jsonb, regles_pax jsonb, sac_ordre smallint,
  arrivee date, resa_code text, voyageurs integer, nb_configs integer, couchage jsonb,
  recouche_jeux smallint, recouche_linge boolean
)
language sql stable security definer set search_path = public as $$
  with m as (
    select mm.*, b.code
    from mission_menage mm join bien b on b.id = mm.bien_id
    where mm.date_mission = p_date
      and mm.statut <> 'cancelled'
      and (mm.type_mission = 'checkout' or (mm.type_mission = 'recouche' and coalesce(mm.recouche_linge, true)))
      and (auth.role() = 'service_role' or auth_user_is_bureau()
           or (auth_user_is_staff() and (my_secteurs() is null or mm.bien_id in (select my_scoped_bien_ids()))))
  ), x as (
    select m.*,
      -- Ménage de départ : le sac prépare la PROCHAINE arrivée ; recouche : le séjour en cours.
      (select r from reservation r
        where r.bien_id = m.bien_id and r.final_status = 'accepted'
          and case when m.type_mission = 'recouche'
                   then (m.vente_resa_hospitable_id is not null and r.hospitable_id = m.vente_resa_hospitable_id)
                        or (m.vente_resa_hospitable_id is null and r.arrival_date <= m.date_mission and r.departure_date > m.date_mission)
                   else r.arrival_date >= m.date_mission end
        order by r.arrival_date limit 1) as r
    from m
  )
  select x.id, x.date_mission, x.heure_mission, x.type_mission, x.statut,
         x.bien_id, x.code, ae.prenom,
         s.id, s.etiquette, s.sous_etiquette, s.blocs, s.regles_pax, s.ordre,
         (x.r).arrival_date, (x.r).code,
         coalesce(case when x.type_mission = 'recouche' then x.vente_voyageurs::int end, (x.r).guest_count),
         (select count(*)::int from bien_couchage c where c.bien_id = x.bien_id and c.actif),
         case when exists (select 1 from bien_couchage c where c.bien_id = x.bien_id and c.actif)
              then couchage_pour(x.bien_id, (x.r).hospitable_id,
                                 coalesce(case when x.type_mission = 'recouche' then x.vente_voyageurs::int end, (x.r).guest_count)) end,
         x.recouche_jeux, x.recouche_linge
  from x
  left join auto_entrepreneur ae on ae.id = x.ae_id
  left join bien_sac_preparation s on s.bien_id = x.bien_id and s.actif
  order by x.heure_mission nulls last, x.code, s.ordre
$$;
revoke all on function public.etiquettes_sacs_jour(date) from public, anon;
grant execute on function public.etiquettes_sacs_jour(date) to authenticated, service_role;
