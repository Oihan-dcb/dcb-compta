-- 449 — Anti-double réservation maison entière ↔ chambres (16/10/2026, publication vague 1 : Maison Maïté + 5 chambres).
-- Hospitable bloque déjà mutuellement parent et enfants (parent_child) pour les RÉSERVATIONS (vérifié : 100 % des jours
-- réservés d'une chambre ferment la maison et inversement). Restait un trou côté PowerHouse : une OPTION web de 20 min
-- (devis_option), une réservation pas encore resynchronisée ou un séjour hors Hospitable sur une chambre ne fermait pas
-- la maison (et inversement) dans calendrier_creneau_conflits. On ajoute les biens LIÉS : le parent (bien.parent_bien_id)
-- et les enfants du bien. Les chambres sœurs restent indépendantes. Même signature, même forme de sortie ; champ `bien`
-- (code du bien lié) ajouté pour les conflits venant d'un autre bien.
create or replace function public.calendrier_creneau_conflits(p_bien uuid, p_debut date, p_fin date, p_ignorer_devis uuid default null::uuid)
returns jsonb language sql stable set search_path to 'public' as $function$
  with lies as (
    select p_bien as id
    union select b.parent_bien_id from bien b where b.id = p_bien and b.parent_bien_id is not null
    union select e.id from bien e where e.parent_bien_id = p_bien
  )
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select 'reservation' as genre, r.code as ref, coalesce(nullif(trim(r.guest_name), ''), 'voyageur') as nom, r.arrival_date as debut, r.departure_date as fin,
           case when r.bien_id <> p_bien then (select code from bien where id = r.bien_id) end as bien
      from reservation r where r.bien_id in (select id from lies) and r.final_status = 'accepted' and r.sejour_hors_id is null and r.arrival_date < p_fin and r.departure_date > p_debut
    union all
    select 'devis_option', d.id::text, d.voyageur_prenom || ' ' || d.voyageur_nom, d.arrivee, d.depart,
           case when d.bien_id <> p_bien then (select code from bien where id = d.bien_id) end
      from devis_option d where d.bien_id in (select id from lies) and d.statut = 'option' and d.arrivee < p_fin and d.depart > p_debut
        and d.id is distinct from p_ignorer_devis
    union all
    select 'sejour_hors_hospitable', s.id::text, s.nom, s.date_debut, s.date_fin,
           case when s.bien_id <> p_bien then (select code from bien where id = s.bien_id) end
      from sejour_hors_hospitable s where s.bien_id in (select id from lies) and s.annule_le is null and s.date_debut < p_fin and s.date_fin > p_debut
  ) x
$function$;
