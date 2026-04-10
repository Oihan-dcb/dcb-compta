-- Ajout du champ brut voyageur (total_price CSV Hospitable)
-- gross_revenue = montant total payé par le client (nuitées + frais + taxes)
-- Source directe CSV colonne "total_price" — remplace la reconstruction fin_accommodation + guest_fees
ALTER TABLE reservation
  ADD COLUMN IF NOT EXISTS fin_gross_revenue integer;

COMMENT ON COLUMN reservation.fin_gross_revenue IS
  'Montant total payé par le voyageur en centimes — source : colonne total_price du CSV Hospitable';
