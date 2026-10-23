-- 596 — 📚 Savoir : catégorie « 🗑 Poubelles et tri » (consigne validée par Oïhan le 23/10/2026, Powy staff)
-- Chaque logement a sa rubrique : jours de collecte, lieu des bacs, règles de tri de la commune. Même table que le reste du
-- Savoir (bien_savoir) : statut « a_relire » tant que le bureau n'a pas relu (jamais lu par l'IA voyageurs, le portail
-- voyageur ni le guide d'arrivée), puis « actif ». Source (URL + date) dans sources / source_date.
alter table public.bien_savoir drop constraint if exists bien_savoir_categorie_check;
alter table public.bien_savoir add constraint bien_savoir_categorie_check check (categorie = any (array[
  'arrivee', 'depart', 'acces_parking', 'internet', 'equipements', 'piscine_exterieur', 'menage_linge', 'bagages',
  'services_payants', 'regles', 'securite_urgence', 'quartier_transports', 'reservation_paiement', 'poubelles_tri', 'autre']::text[]));
