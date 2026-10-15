-- 422 — Vente directe : type de widget « bandeau » (15/10/2026).
-- Bandeau de recherche horizontal façon accueil de destinationcotebasque.com (destination, arrivée → départ,
-- voyageurs, Rechercher) → /reserver?arrivee=…&depart=…&adultes=…&enfants=…&dest=… (dcb-planning).
alter table public.direct_widget drop constraint if exists direct_widget_type_check;
alter table public.direct_widget add constraint direct_widget_type_check
  check (type = any (array['bouton'::text, 'calendrier'::text, 'recherche'::text, 'bandeau'::text]));
