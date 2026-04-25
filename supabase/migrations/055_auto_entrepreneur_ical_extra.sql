-- ============================================================
-- PowerHouse DCB — Calendriers perso + pro par staff/AE
-- Colonnes ical_perso et ical_pro sur auto_entrepreneur
-- ============================================================
-- ical_url  = calendrier Hospitable (missions ménage)     → source "ical"
-- ical_pro  = calendrier pro (RDVs, pro hors Hospitable)  → source "rdv"
-- ical_perso = calendrier perso (affiché "Indisponible")  → source "perso"

alter table auto_entrepreneur
  add column if not exists ical_pro   text,
  add column if not exists ical_perso text;

-- Oihan : pré-remplir avec les valeurs actuellement hardcodées dans api/ical.js
update auto_entrepreneur set
  ical_pro   = 'https://p147-caldav.icloud.com/published/2/MjkyNDI2OTQwMjkyNDI2ORYrYUWixB476UePaQt-pPO8boa7Rx08bP2KmIwKKe9m',
  ical_perso = 'https://p147-caldav.icloud.com/published/2/MjkyNDI2OTQwMjkyNDI2ORYrYUWixB476UePaQt-pPPceScUVT_tIialuenR5PE5'
where lower(prenom) = 'oihan';
