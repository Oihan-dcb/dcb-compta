-- Migration 270 : frais retenus sur le loyer d'un bien où le propriétaire paie lui-même ses factures
-- (24/09/2026, suite I-153).
--
-- Depuis 8a978ce, les frais « déduire du loyer » sont facturés en ligne POSITIVE et inclus dans le
-- total (avant : négatifs, ce qui faisait un avoir chez Evoliz). Pour un bien mode_encaissement=
-- 'dcb', toute la facture est déjà réglée par retenue sur le reversement. Mais pour un bien
-- mode_encaissement='proprio' dont DCB encaisse une partie des loyers (résas directes, ex. GASQ),
-- le propriétaire règle la facture par virement ALORS QUE le frais a déjà été retenu sur son
-- reversement : sans rien de plus, il le paierait deux fois.
--
-- montant_retenu_loyer : part de la facture déjà réglée par retenue (posée à la génération).
-- sync-evoliz-statut l'enregistre comme paiement partiel dès que la facture est validée chez Evoliz
-- (impossible sur un brouillon) → reste_a_payer_evoliz, rapprochement et relances en tiennent compte.
ALTER TABLE public.facture_evoliz
  ADD COLUMN IF NOT EXISTS montant_retenu_loyer     integer,      -- centimes TTC
  ADD COLUMN IF NOT EXISTS retenue_evoliz_payee_at  timestamptz;  -- paiement partiel posé chez Evoliz

COMMENT ON COLUMN public.facture_evoliz.montant_retenu_loyer IS
  'Centimes TTC de frais « déduire du loyer » déjà retenus sur le reversement d''un bien mode proprio : part de la facture déjà réglée. Enregistrée comme paiement chez Evoliz par sync-evoliz-statut (retenue_evoliz_payee_at).';
