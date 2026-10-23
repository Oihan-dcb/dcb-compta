-- 592 : arrivée tardive avec accueil EN PERSONNE — barème d'Oïhan du 23/10/2026
--   avant 19h30 : inclus (horaires normaux) ; à partir de 19h30 : 50 € ; de 22h00 à 23h00 : 70 € ;
--   de 23h00 à minuit : 100 € ; après minuit : 170 €.
--   Seulement quand l'arrivée se fait en personne (jamais pour une arrivée autonome : boîte à clés, serrure).
-- Catalogue des options (🧺 Services) : 4 tranches, DCB et Lauïan, DÉSACTIVÉES (actif = false) : Oïhan les ouvre.
-- direct_service.accueil_en_personne : option réservée aux logements accueillis en personne
--   (bien.type_arrivee = 'en_personne' ou bien.accueil_proprio) ; filtre dans api/_services.offresBien (raison
--   « arrivee_autonome » dans la vue Portée des options).

alter table public.direct_service add column if not exists accueil_en_personne boolean not null default false;
comment on column public.direct_service.accueil_en_personne is
  'true = option proposée seulement aux logements avec accueil en personne (bien.type_arrivee = en_personne ou bien.accueil_proprio) — ex. arrivée tardive (592)';

insert into public.direct_service (agence, cle, type, nom, description, prix_centimes, unite, quantite_max, actif, ordre,
  delai_min_h, prix_regle, nom_en, nom_es, description_en, description_es, accueil_en_personne, maj_par)
select a.agence, t.cle, 'service', t.nom, t.descr, t.prix, 'par_sejour', 1, false, t.ordre,
  4, 'fixe', t.nom_en, t.nom_es, t.descr_en, t.descr_es, true, 'migration 592 (barème Oïhan 23/10/2026)'
from (values ('dcb'), ('lauian')) a(agence)
cross join (values
  ('arrivee_tardive_1930', 'Arrivée entre 19 h 30 et 22 h', 'Accueil en personne entre 19 h 30 et 22 h (avant 19 h 30 : inclus).', 5000, 64,
   'Arrival between 7:30 pm and 10 pm', 'Llegada entre las 19:30 y las 22 h',
   'In-person welcome between 7:30 pm and 10 pm (before 7:30 pm: included).', 'Recibimiento en persona entre las 19:30 y las 22 h (antes de las 19:30: incluido).'),
  ('arrivee_tardive_22h', 'Arrivée entre 22 h et 23 h', 'Accueil en personne entre 22 h et 23 h.', 7000, 65,
   'Arrival between 10 pm and 11 pm', 'Llegada entre las 22 h y las 23 h',
   'In-person welcome between 10 pm and 11 pm.', 'Recibimiento en persona entre las 22 h y las 23 h.'),
  ('arrivee_tardive_23h', 'Arrivée entre 23 h et minuit', 'Accueil en personne entre 23 h et minuit.', 10000, 66,
   'Arrival between 11 pm and midnight', 'Llegada entre las 23 h y medianoche',
   'In-person welcome between 11 pm and midnight.', 'Recibimiento en persona entre las 23 h y medianoche.'),
  ('arrivee_tardive_minuit', 'Arrivée après minuit', 'Accueil en personne après minuit.', 17000, 67,
   'Arrival after midnight', 'Llegada después de medianoche',
   'In-person welcome after midnight.', 'Recibimiento en persona después de medianoche.')
) t(cle, nom, descr, prix, ordre, nom_en, nom_es, descr_en, descr_es)
on conflict (agence, cle) do nothing;
