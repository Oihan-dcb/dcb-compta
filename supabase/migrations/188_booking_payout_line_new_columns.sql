-- Migration 188 : booking_payout_line — colonnes pour le nouveau format CSV Booking (par payout)
--
-- Le nouveau format Booking (Finance > Payouts > détail par payout) apporte :
--   - Tourism tax     : taxe de séjour retenue par Booking
--   - Payments Service Fee : frais de service
--   - Payout ID       : identifiant du payout (ex: EMxN1iaRF9TWq0h1) — présent dans le libellé
--                        bancaire sous la forme "NO.EMxN1iaRF9TWq0h1", permet un match exact

ALTER TABLE booking_payout_line
  ADD COLUMN IF NOT EXISTS tourism_tax_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_id text;

COMMENT ON COLUMN booking_payout_line.tourism_tax_cents IS 'Taxe de séjour retenue par Booking (valeur absolue, en centimes)';
COMMENT ON COLUMN booking_payout_line.service_fee_cents IS 'Frais de service Booking (valeur absolue, en centimes)';
COMMENT ON COLUMN booking_payout_line.payout_id IS 'Identifiant du payout Booking (ex: EMxN1iaRF9TWq0h1) — présent dans le libellé bancaire sous NO.{payout_id}';

CREATE INDEX IF NOT EXISTS idx_booking_payout_line_payout_id
  ON booking_payout_line(payout_id)
  WHERE payout_id IS NOT NULL;
