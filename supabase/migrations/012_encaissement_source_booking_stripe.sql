-- Migration 012 : ajouter booking_payout_line et stripe_payout_line comme source_type valides
-- Ces chemins couvrent Booking et Direct/Stripe quand reservation_paiement n'est pas créé

ALTER TABLE encaissement_allocation
  DROP CONSTRAINT IF EXISTS encaissement_allocation_source_type_check;

ALTER TABLE encaissement_allocation
  ADD CONSTRAINT encaissement_allocation_source_type_check
    CHECK (source_type IN (
      'payout_hospitable',
      'reservation_paiement',
      'ventilation',
      'booking_payout_line',
      'stripe_payout_line',
      'manual'
    ));
