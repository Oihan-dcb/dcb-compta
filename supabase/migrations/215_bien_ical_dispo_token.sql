-- 215_bien_ical_dispo_token.sql
-- Token secret par bien pour le proxy iCal "disponibilités seules" (dcb-planning /api/ical-dispo?t=…).
-- Permet de partager les dispos (occupé/libre, sans PII) à une agence partenaire / channel manager
-- via une URL non devinable. Déjà appliqué en prod ; ce fichier le rend reproductible.

alter table bien add column if not exists ical_dispo_token text;

-- Token aléatoire (32 hex) pour chaque bien sans token
update bien set ical_dispo_token = replace(gen_random_uuid()::text, '-', '')
where ical_dispo_token is null;

create unique index if not exists idx_bien_ical_dispo_token
  on bien(ical_dispo_token) where ical_dispo_token is not null;
