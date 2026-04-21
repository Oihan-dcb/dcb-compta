-- Migration 027 : google_review_url dans agency_config
-- Chaque agence a son propre lien Google Review (SMS reviews)

ALTER TABLE agency_config ADD COLUMN IF NOT EXISTS google_review_url text;

-- Commentaire : renseigner les URLs via Supabase Studio ou une update manuelle
-- UPDATE agency_config SET google_review_url = 'https://g.page/r/...' WHERE agence = 'dcb';
-- UPDATE agency_config SET google_review_url = 'https://g.page/r/...' WHERE agence = 'lauian';
