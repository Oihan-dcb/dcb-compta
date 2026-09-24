-- Migration 268 : montant et numéro RÉELS de la facture chez Evoliz (audit segment Factures, I-153)
--
-- Evoliz recalcule la TVA à partir du HT ligne par ligne : le TTC de la facture émise diffère de
-- quelques centimes de facture_evoliz.total_ttc sur ~30 factures 2026 (DUL août 2 671,52 € chez
-- Evoliz, 2 671,50 € en base), et de plusieurs dizaines d'euros quand des lignes FRAIS étaient
-- poussées en négatif (GASQ juillet 1 952,40 € contre 2 002,38 €). Le propriétaire paie le montant
-- du PDF : le rapprochement automatique (montant exact sur total_ttc) ne le reconnaissait jamais,
-- et les relances citaient un montant et un numéro (T-… de brouillon, 75 factures) qui n'existent
-- pas sur sa facture. sync-evoliz-statut renseigne désormais ces colonnes chaque nuit.
ALTER TABLE public.facture_evoliz
  ADD COLUMN IF NOT EXISTS total_ttc_evoliz      integer,     -- centimes, TTC de la facture chez Evoliz
  ADD COLUMN IF NOT EXISTS reste_a_payer_evoliz  integer,     -- centimes, net_to_pay Evoliz
  ADD COLUMN IF NOT EXISTS evoliz_synced_at      timestamptz;

COMMENT ON COLUMN public.facture_evoliz.total_ttc_evoliz IS
  'TTC réel de la facture chez Evoliz (source de vérité du montant dû), relu chaque nuit par sync-evoliz-statut. total_ttc = calcul local.';
COMMENT ON COLUMN public.facture_evoliz.reste_a_payer_evoliz IS
  'Reste à payer chez Evoliz (net_to_pay), relu chaque nuit par sync-evoliz-statut. Utilisé par le rapprochement auto et les relances.';
