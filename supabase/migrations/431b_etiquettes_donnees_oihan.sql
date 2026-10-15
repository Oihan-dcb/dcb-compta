-- 431b — Réponses d'Oïhan (15/10/2026) appliquées aux données (historique : fiche_historique via triggers).
-- Les étiquettes de préparation restent la source de vérité ; ces corrections viennent d'Oïhan lui-même.

-- 0. Couchage : supplément conditionné au nombre de voyageurs (ex. BGH « 2 grands lits » : +30 € si ≤ 2 voyageurs).
alter table public.bien_couchage add column if not exists supplement_voyageurs_max smallint
  check (supplement_voyageurs_max is null or supplement_voyageurs_max between 1 and 30);
comment on column public.bien_couchage.supplement_voyageurs_max is
  'Supplément appliqué seulement si voyageurs ≤ cette valeur (null = toujours). 431b, BGH : 2 grands lits +30 € si ≤ 2 voyageurs.';

-- 1. « 480P » = faute de frappe pour 408P (Ikuspegi) ; contenu aligné sur 506P SANS canapé-lit ni règle 4 PAX.
update public.bien_sac_preparation s
   set bien_id = b.id, etiquette = '408P', note = 'Étiquette « 480P » corrigée en 408P (Oïhan 15/10/2026) ; contenu aligné sur 506P sans canapé-lit',
       blocs = (select s5.blocs from public.bien_sac_preparation s5 where s5.etiquette = '506P' and s5.actif limit 1),
       regles_pax = '[]'::jsonb, maj_le = now(), maj_par = 'migration 431b'
  from public.bien b
 where b.code = '408P' and s.etiquette = '480P' and s.source = 'feuilles_preparation_pdf';

insert into public.bien_lit (bien_id, piece, type, largeur_cm, longueur_cm, places, ordre, actif, source, maj_par, linge, note)
select b.id, l.piece, l.type, l.largeur_cm, l.longueur_cm, l.places, 1, true, 'saisi', 'migration 431b', l.linge, 'Comme 506P sans le canapé-lit (Oïhan 15/10/2026)'
  from public.bien b, public.bien_lit l join public.bien b5 on b5.id = l.bien_id
 where b.code = '408P' and b5.code = '506P' and l.type <> 'canape_lit' and l.actif
   and not exists (select 1 from public.bien_lit x where x.bien_id = b.id and x.actif);

update public.bien_toolbox t
   set linge_plat = '1 Drap Queen + 1 Housse Queen · 2 Taies Carrées · 2 Taies Rectangulaires',
       linge_eponge = '2 grandes serviettes · 2 Petites serviettes · 2 carré visage · 1 Tapis de bain',
       consommables = '1 Torchon · 1 Eponge · 1 Microfibre grise +1 noire · 4 Capsule Nespresso · 2 Rouleaux de papier toilette · 1 Box detergent + 1 Box lave vaisselle · 1 liquide vaisselle + 1 liquide corps · 1 Serpillère Villeda · 4 Microfibres de ménage · 2 sac 20L + 2 sac 50L · 2 Sacs lingerie + 1 sac plastique',
       updated_at = now()
  from public.bien b where b.id = t.bien_id and b.code = '408P';

-- 2. « ITS 2 » = 2e sac du bien ITS (Itsasarte) : beaucoup de linge → 2 sacs, sous-étiquettes « 1 » et « 2 ».
update public.bien_sac_preparation s
   set bien_id = b.id, etiquette = 'ITS', sous_etiquette = '2', note = '2e sac d''ITS (Oïhan 15/10/2026)', maj_le = now(), maj_par = 'migration 431b'
  from public.bien b where b.code = 'ITS' and s.etiquette = 'ITS 2';
update public.bien_sac_preparation s
   set sous_etiquette = '1', maj_le = now(), maj_par = 'migration 431b'
  from public.bien b where b.code = 'ITS' and s.bien_id = b.id and s.etiquette = 'ITS' and s.sous_etiquette is null;

-- 3. Capacités (PowerHouse : bien.capacite ; la synchro Hospitable n'écrit que hospitable_capacite).
update public.bien set capacite = 11 where code = 'M-MAITE' and capacite is distinct from 11;
update public.bien set capacite = 10 where code = 'BERDEA'  and capacite is distinct from 10;
update public.bien set capacite = 3  where code = 'ONGI'    and capacite is distinct from 3;

-- 4. BGH : « 2 grands lits » +30 € quand ≤ 2 voyageurs (ouverture des 2 chambres), 0 € sinon → ligne Option voyageur (PVOY).
update public.bien_couchage c
   set supplement_centimes = 3000, supplement_voyageurs_max = 2, maj_le = now(), maj_par = 'migration 431b'
  from public.bien b where b.id = c.bien_id and b.code = 'BGH' and c.nom = '2 grands lits';

-- 5. Recouches au catalogue Lauïan : même règle que DCB (ménage le plus élevé × 1,30 ; sans changement −45 €/lit,
--    minimum 50 €), désactivées comme celles de DCB.
insert into public.direct_service (cle, nom, type, actif, ordre, unite, agence, maj_par, nom_en, nom_es, nuits_min, prix_coef, prix_regle,
  delai_min_h, description, mission_type, quantite_max, equipment_ids, prix_centimes, description_en, description_es, recouche_linge,
  linge_jeu_centimes, prix_minimum_centimes)
select cle, nom, type, false, ordre, unite, 'lauian', 'migration 431b', nom_en, nom_es, nuits_min, prix_coef, prix_regle,
  delai_min_h, description, mission_type, quantite_max, '{}', prix_centimes, description_en, description_es, recouche_linge,
  linge_jeu_centimes, prix_minimum_centimes
  from public.direct_service where agence = 'dcb' and cle in ('recouche', 'menage_sejour')
on conflict (agence, cle) do nothing;
