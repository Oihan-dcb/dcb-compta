-- Migration 282 : compensations inter-agences sur la fiche séquestre (25/09/2026).
-- LVH : 11 séjours du bien DCB BDX (août-sept. 2025) versés par Airbnb sur le séquestre Shine Lauïan,
-- alors que DCB a payé la propriétaire (Emma Lalande) depuis son ancien séquestre …727. Lauïan doit
-- 3 067,68 € au séquestre DCB ; récupérés par compensation sur ce que DCB doit reverser à Lauïan
-- (résas Lauïan 2026 encaissées par le Stripe DCB, 9 151,00 €) → net 6 083,32 €.
-- Le justificatif retire ces montants de la poche « autre agence » et les porte dans une poche dédiée.
ALTER TABLE public.sequestre_compte ADD COLUMN IF NOT EXISTS compensations_inter_agence jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.sequestre_compte SET compensations_inter_agence = '[{"agence":"lauian","montant":306768,"motif":"LVH — 11 séjours BDX (Le Bouscat) août-sept. 2025 versés par Airbnb sur le Shine Lauïan ; DCB a payé Emma Lalande 862,80 € (09/09/2025) + 831,62 € (07/10/2025) depuis l ancien séquestre …727. Récupéré par compensation sur le reversement DCB → Lauïan (décision Oïhan 25/09/2026).","date":"2026-09-25"}]'::jsonb
WHERE agence='dcb';
