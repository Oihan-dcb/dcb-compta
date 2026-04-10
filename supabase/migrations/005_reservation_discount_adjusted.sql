-- Ajout remise voyageur et ajustements (colonnes CSV Hospitable)
ALTER TABLE reservation
  ADD COLUMN IF NOT EXISTS fin_discount  integer,
  ADD COLUMN IF NOT EXISTS fin_adjusted  integer;

COMMENT ON COLUMN reservation.fin_discount  IS 'Remise appliquée au client en centimes — source : guest_discount CSV';
COMMENT ON COLUMN reservation.fin_adjusted  IS 'Ajustements/remboursements en centimes — source : adjusted_amount CSV';
