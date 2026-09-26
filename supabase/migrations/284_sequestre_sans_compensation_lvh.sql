-- Migration 284 : décision Oïhan (26/09/2026) — pas de compensation inter-agences, pour un suivi comptable
-- plus simple : le séquestre DCB reverse 100 % des résas Lauïan encaissées sur le Stripe DCB (9 151,00 €) et
-- le séquestre Lauïan reverse 100 % des résas DCB encaissées chez lui (LVH 2025 : 3 067,68 €).
-- La colonne compensations_inter_agence (migration 282) reste disponible mais vide.
UPDATE public.sequestre_compte SET compensations_inter_agence = '[]'::jsonb WHERE agence = 'dcb';
