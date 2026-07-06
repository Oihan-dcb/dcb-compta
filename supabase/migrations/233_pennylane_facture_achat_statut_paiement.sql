-- Migration 233 : statut de paiement Pennylane sur facture_achat
--
-- Pennylane réconcilie déjà nativement les factures fournisseurs avec les transactions
-- du compte courant (sa propre connexion bancaire). Pas besoin de matching maison :
-- on interroge périodiquement GET /supplier_invoices/{id} (champ `paid`) et on
-- remonte le résultat ici.

ALTER TABLE facture_achat
  ADD COLUMN IF NOT EXISTS pennylane_paye boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pennylane_date_paiement date;

COMMENT ON COLUMN facture_achat.pennylane_paye IS
  'Reflète le champ "paid" de la facture fournisseur Pennylane (réconciliation bancaire native, compte courant)';
