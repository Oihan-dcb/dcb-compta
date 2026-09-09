-- 253_ical_tokens_rdv_equipment.sql
-- Ferme deux flux iCal publics sans aucune authentification :
-- - /api/ical-rdv?staff=<prenom> : prénom devinable, expose les missions (description/note/heure)
--   de n'importe quel staff (AUDIT.md P2-1).
-- - /api/equipment-ical?agence=dcb (ou sans paramètre du tout, 'dcb' par défaut) : expose TOUTES
--   les réservations d'équipement du parc, avec guest_name (PII voyageur) + prix.
-- Ces deux endpoints sont des URLs webcal:// souscrites une fois dans un client calendrier
-- (Apple/Google Calendar) — aucune auth par header n'est possible par nature. Seule protection
-- possible : un secret dans l'URL, comme déjà fait pour /api/ical-dispo via 215_bien_ical_dispo_token.sql
-- (même convention reprise ici : text 32-hex sans tiret, pas uuid brut).

alter table auto_entrepreneur add column if not exists ical_rdv_token text
  default replace(gen_random_uuid()::text, '-', '');

update auto_entrepreneur set ical_rdv_token = replace(gen_random_uuid()::text, '-', '')
where ical_rdv_token is null;

create unique index if not exists idx_ae_ical_rdv_token
  on auto_entrepreneur(ical_rdv_token) where ical_rdv_token is not null;

comment on column auto_entrepreneur.ical_rdv_token is
  'Secret 32-hex pour l''abonnement webcal:// /api/ical-rdv?t=… (missions manuelles du staff). '
  'Distinct de token_acces (liaison compte auth, audité classe C) : celui-ci circule dans une URL '
  'de calendrier, pas dans un flux d''auth applicatif. Le régénérer coupe l''abonnement du staff, '
  'qui doit se réabonner avec le nouveau lien.';

alter table equipment add column if not exists ical_token text
  default replace(gen_random_uuid()::text, '-', '');

update equipment set ical_token = replace(gen_random_uuid()::text, '-', '')
where ical_token is null;

create unique index if not exists idx_equipment_ical_token
  on equipment(ical_token) where ical_token is not null;

comment on column equipment.ical_token is
  'Secret 32-hex pour /api/equipment-ical?t=… (réservations équipement : guest_name + prix). '
  'Le mode ?agence= (calendrier de tout le parc, sans aucun paramètre secret) est supprimé côté API '
  'à ce même changement — aucun appelant recensé dans l''écosystème DCB au 09/09/2026.';
