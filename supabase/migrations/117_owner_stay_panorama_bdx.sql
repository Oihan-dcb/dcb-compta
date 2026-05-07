-- Migration 117 : Marquer GFL7PA et O6WGXX comme owner_stay (Panorama BDX)
-- Ces réservations sont des séjours propriétaire, pas des réservations voyageur.

UPDATE reservation
SET owner_stay = true
WHERE code IN ('GFL7PA', 'O6WGXX');
