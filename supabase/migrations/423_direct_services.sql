-- 423 — Vente directe : SERVICES / UPSELLS (15/10/2026, demande d'Oïhan).
-- Catalogue CENTRAL de services proposés au voyageur dans le parcours de réservation (page Réserver, widget, devis),
-- réutilisable par plusieurs biens, avec surcharges PAR BIEN (proposé ou non, prix, quantité max).
-- Branché sur les circuits EXISTANTS (dcb-planning api/_services.js) — aucun circuit parallèle :
--   type 'equipement'  → equipment_bookings (pool d'équipements equipment_ids : lit bébé 1/2/3…) — même table que
--                        📦 Équipements et le panneau du séjour ; installer / ranger via equipement_sejours() /
--                        mission_equipement() ; onglet Équipements du Calendrier ; jamais de surréservation
--                        (dispo = quantités − locations non annulées − options web en cours qui chevauchent) ;
--   type 'consommable' → besoin_sac (à préparer pour le bien, item du catalogue_items) → Sacs et tâches ;
--   type 'service'     → prestation à organiser par le bureau (ex. ménage en cours de séjour) : note + alerte bureau,
--                        AUCUNE mission créée automatiquement (pas d'état brouillon dans mission_menage : une mission
--                        « planifie » serait proposée d'office aux AE) ;
--   type 'demande'     → sur demande, sans prix ni engagement (arrivée anticipée, départ tardif) : transmis au bureau.
-- Prix TTC en centimes ; ligne de devis séparée « Option voyageur : <nom> » → frais libres → PVOY en compta
-- (dcb-compta ventilationCore, règle frais agence 2026-10).
create table if not exists public.direct_service (
  id uuid primary key default gen_random_uuid(),
  agence text not null default 'dcb' check (agence in ('dcb', 'lauian')),
  cle text not null check (cle ~ '^[a-z0-9_]{2,40}$'),
  type text not null check (type in ('equipement', 'consommable', 'service', 'demande')),
  nom text not null check (char_length(nom) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  prix_centimes integer check (prix_centimes is null or prix_centimes between 0 and 500000),
  unite text not null default 'par_sejour' check (unite in ('par_sejour', 'par_nuit', 'par_jour')),
  quantite_max integer not null default 1 check (quantite_max between 1 and 20),
  equipment_ids uuid[] not null default '{}',
  catalogue_item_id uuid references public.catalogue_items(id) on delete set null,
  actif boolean not null default true,          -- proposé par défaut à tous les biens de l'agence
  ordre integer not null default 100,
  maj_le timestamptz not null default now(),
  maj_par text,
  unique (agence, cle),
  check (type = 'demande' or prix_centimes is not null),
  check (type <> 'equipement' or cardinality(equipment_ids) > 0)
);
create table if not exists public.bien_direct_service (
  bien_id uuid not null references public.bien(id) on delete cascade,
  service_id uuid not null references public.direct_service(id) on delete cascade,
  propose boolean not null default true,         -- surcharge : proposé (true) / retiré (false) pour ce bien
  prix_centimes integer check (prix_centimes is null or prix_centimes between 0 and 500000),
  quantite_max integer check (quantite_max is null or quantite_max between 1 and 20),
  maj_le timestamptz not null default now(),
  maj_par text,
  primary key (bien_id, service_id)
);
alter table public.direct_service enable row level security;
alter table public.bien_direct_service enable row level security;
drop policy if exists direct_service_lecture on public.direct_service;
create policy direct_service_lecture on public.direct_service for select using (auth_user_is_staff());
drop policy if exists direct_service_ecriture on public.direct_service;
create policy direct_service_ecriture on public.direct_service for all using (auth_user_is_staff() and my_secteurs() is null) with check (auth_user_is_staff() and my_secteurs() is null);
drop policy if exists bien_direct_service_staff on public.bien_direct_service;
create policy bien_direct_service_staff on public.bien_direct_service for all
  using (auth_user_is_staff() and ((my_secteurs() is null) or (bien_id in (select my_scoped_bien_ids()))))
  with check (auth_user_is_staff() and ((my_secteurs() is null) or (bien_id in (select my_scoped_bien_ids()))));

-- Catalogue initial (tarifs = ceux de 📦 Équipements ; ménage en cours de séjour = 75 € au 416 d'après le Knowledge Hub).
insert into public.direct_service (agence, cle, type, nom, description, prix_centimes, unite, quantite_max, equipment_ids, actif, ordre, maj_par) values
 ('dcb', 'lit_bebe', 'equipement', 'Lit bébé', 'Lit parapluie installé avant votre arrivée.', 5000, 'par_sejour', 2,
   array(select id from equipment where agence = 'dcb' and actif and nom ilike 'lit bébé%'), true, 10, 'migration 423'),
 ('dcb', 'chaise_haute', 'equipement', 'Chaise haute', 'Installée avant votre arrivée.', 500, 'par_jour', 1,
   array(select id from equipment where agence = 'dcb' and actif and nom ilike 'chaise haute%'), true, 20, 'migration 423'),
 ('dcb', 'lit_appoint_80', 'equipement', 'Lit d''appoint 1 place', 'Matelas d''appoint 80 cm avec linge.', 8000, 'par_sejour', 1,
   array(select id from equipment where agence = 'dcb' and actif and nom ilike 'lit d''appoint%80%'), true, 30, 'migration 423'),
 ('dcb', 'lit_appoint_160', 'equipement', 'Lit d''appoint 2 places', 'Matelas d''appoint 160 cm avec linge.', 12000, 'par_sejour', 1,
   array(select id from equipment where agence = 'dcb' and actif and nom ilike 'lit d''appoint%160%'), true, 40, 'migration 423'),
 ('dcb', 'kit_plage', 'equipement', 'Kit plage', 'Parasol, chaises et serviettes de plage.', 300, 'par_jour', 2,
   array(select id from equipment where agence = 'dcb' and actif and nom ilike 'kit plage%'), true, 50, 'migration 423'),
 ('dcb', 'menage_sejour', 'service', 'Ménage en cours de séjour', 'Ménage complet pendant le séjour, à une date convenue avec vous.', 7500, 'par_sejour', 2,
   '{}', false, 60, 'migration 423'),
 ('dcb', 'arrivee_anticipee', 'demande', 'Arrivée anticipée', 'Sur demande, selon le ménage du jour : nous vous confirmons la possibilité avant votre arrivée.', null, 'par_sejour', 1,
   '{}', true, 70, 'migration 423'),
 ('dcb', 'depart_tardif', 'demande', 'Départ tardif', 'Sur demande, selon l''arrivée suivante : nous vous confirmons la possibilité avant votre départ.', null, 'par_sejour', 1,
   '{}', true, 80, 'migration 423')
on conflict (agence, cle) do nothing;
-- 416 : ménage en cours de séjour proposé à 75 € (Knowledge Hub).
insert into public.bien_direct_service (bien_id, service_id, propose, prix_centimes, maj_par)
select b.id, s.id, true, 7500, 'migration 423' from bien b join direct_service s on s.agence = 'dcb' and s.cle = 'menage_sejour' where b.code = '416'
on conflict do nothing;
