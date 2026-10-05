-- 309 — Entretien périodique = HORS FORFAIT facturé au propriétaire (05/10/2026)
-- Source : « Détail forfait / hors forfait » (doc DCB) + décisions Oïhan 05/10/2026 :
--   - entretien « normal » hors forfait → facturé au PROPRIÉTAIRE : chaque « Fait » crée une
--     prestation_hors_forfait EN ATTENTE (type_imputation='deduction_loy', payée à l'AE après
--     validation bureau dans PowerHouse → Gestion), liée par bien_entretien_fait.prestation_id ;
--   - plans activés UNIQUEMENT après validation par bien (suggestions calculées, jamais d'office) ;
--   - entretien proposé en priorité sur les ménages de fond ; en ménage départ seulement le rouge ;
--   - matelas, rideaux, frigo à fond, sous les lits, bacs poubelle, barbecue = hors forfait périodique.
-- Le « prévu dans le temps de travail » (détartrage léger, bonde à l'eau, microfibre vitres…) reste
-- dans la checklist, jamais facturé. L'« hors forfait constaté » (sable, vitres après tempête, four
-- très sale…) passe par le bouton Extra constaté de Ma journée (propriétaire ou voyageur).
alter table public.entretien_type add column if not exists prestation_type_id uuid references public.prestation_type(id) on delete set null;
alter table public.entretien_type add column if not exists equipement text;  -- null = tous les biens ; sinon lave_linge, lave_vaisselle, hotte, deshumidificateur, exterieur, barbecue
alter table public.bien_entretien_fait add column if not exists prestation_id uuid references public.prestation_hors_forfait(id) on delete set null;

-- Catalogue aligné sur le document
update public.entretien_type set nom = 'Grilles d''aération / VMC démontées à la brosse', periodicite_jours = 90,
  consigne = 'Démonter, entretenir et nettoyer à la brosse, aspirer les aérations, remonter.' where nom = 'Bouches VMC';
update public.entretien_type set nom = 'Lave-linge : vidange et entretien des filtres', equipement = 'lave_linge' where nom = 'Filtre lave-linge';
update public.entretien_type set nom = 'Lave-vaisselle : filtres à la brosse et grande eau', equipement = 'lave_vaisselle' where nom = 'Filtre lave-vaisselle';
update public.entretien_type set nom = 'Hotte : filtres dégraissés + filtre à charbon changé', periodicite_jours = 60, equipement = 'hotte',
  consigne = 'Filtres métalliques au lave-vaisselle ou savon noir chaud ; remplacer le filtre à charbon (prévoir la pièce).' where nom = 'Four, plaques et hotte à fond';
update public.entretien_type set nom = 'Joints : traitement poussé avec brossage', consigne = 'Anti-moisissure sur les joints uniquement, brosser activement, rincer.' where nom = 'Joints douche / anti-moisissure';
update public.entretien_type set nom = 'Terrasse et mobilier extérieur au Kärcher', periodicite_jours = 60, equipement = 'exterieur' where nom = 'Mobilier extérieur et terrasse';
update public.entretien_type set equipement = 'barbecue' where nom = 'Barbecue / plancha';
-- Prévu au forfait (doc) ou événementiel → hors du périodique
update public.entretien_type set actif = false where nom in ('Détartrage robinets et pommeaux', 'Vitres et baies (intérieur + extérieur)');
insert into public.entretien_type (nom, icone, periodicite_jours, periodicite_sejours, duree_min, consigne, ordre, equipement) values
  ('Lessivage des murs', '🧱', 30, null, 30, 'Éponge magique puis lessive douce sur les zones marquées (une fois par mois).', 15, null),
  ('Volets, stores et rainures de baies à la brosse', '🪟', 90, null, 30, 'Microfibre sur volets et stores, brosse dans les rainures puis aspirateur.', 16, null),
  ('Dessus de placards de cuisine', '🗄', 30, null, 15, 'Dessus de placards gras : savon noir puis microfibre vinaigrée.', 17, null),
  ('Déshumidificateur : filtres et aérations', '💨', 30, null, 10, 'Nettoyer les filtres, aspirer les aérations, vider le bac.', 18, 'deshumidificateur')
on conflict (nom) do nothing;

-- Rattachement aux types de prestation existants (facturation / paie inchangées)
update public.entretien_type e set prestation_type_id = pt.id
  from public.prestation_type pt
 where e.prestation_type_id is null and trim(pt.nom) = case
   when e.nom like 'Joints%' then 'Joins SDB'
   when e.nom like 'Lave-vaisselle%' or e.nom like 'Hotte%' or e.nom like 'Frigo%' or e.nom like 'Dessus de placards%' then 'Cuisine approfondie'
   when e.nom like 'Terrasse%' or e.nom like 'Barbecue%' then 'Terrasse'
   else 'Ménage Hors forfait' end;

-- Suggestions par bien (non activées) : universels + équipements détectés.
-- lave_linge : fiche pratique Hospitable ou « Machine à laver » configurée à l'inventaire ;
-- lave_vaisselle : « Lave-vaisselle » configuré à l'inventaire. Les autres équipements (hotte,
-- extérieur, barbecue, déshumidificateur) sont proposés décochés : à cocher par le bureau.
create or replace function public.entretien_suggestions(p_bien_id uuid)
returns table (entretien_type_id uuid, nom text, icone text, equipement text, detecte boolean, deja_plan boolean, plan_actif boolean)
language sql stable security definer set search_path = public as $$
  with tb as (select id from bien_toolbox where bien_id = p_bien_id and archived_at is null limit 1),
  eq as (
    select 'lave_linge'::text e where exists (select 1 from bien_faq_pratique f where f.bien_id = p_bien_id and f.lave_linge)
       or exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = (select id from tb) and c.actif and ci.nom ilike 'machine à laver%')
    union select 'lave_vaisselle' where exists (select 1 from inventaire_bien_config c join catalogue_items ci on ci.id = c.item_id
                   where c.bien_id = (select id from tb) and c.actif and ci.nom ilike 'lave-vaisselle')
  )
  select t.id, t.nom, t.icone, t.equipement,
         (t.equipement is null or t.equipement in (select e from eq)),
         pl.id is not null, coalesce(pl.actif, false)
    from entretien_type t
    left join bien_entretien_plan pl on pl.entretien_type_id = t.id and pl.bien_id = p_bien_id
   where t.actif and auth_user_is_internal()
   order by t.ordre;
$$;
revoke all on function public.entretien_suggestions(uuid) from public, anon;
grant execute on function public.entretien_suggestions(uuid) to authenticated;

-- Le prévu au forfait retiré du périodique rejoint la checklist de chaque ménage.
insert into public.checklist_item (type_terrain, libelle, ordre)
select 'menage', 'Détartrage léger robinets et pommeau (vinaigre)', 3
 where not exists (select 1 from public.checklist_item where bien_id is null and libelle like 'Détartrage léger%');
