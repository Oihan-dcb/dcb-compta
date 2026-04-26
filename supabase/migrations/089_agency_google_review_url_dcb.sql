-- Migration 089 : renseigner google_review_url DCB dans agency_config
-- URL extraite des sms_logs existants (SMS déjà envoyés avec succès)

UPDATE agency_config
SET google_review_url = 'https://g.page/r/CdwFPXZkPQ5wEBM/review'
WHERE agence = 'dcb'
  AND (google_review_url IS NULL OR google_review_url = '');
