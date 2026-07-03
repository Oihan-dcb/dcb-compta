-- Migration 221 : part de la réservation dans un payout (montant de la transaction
-- "Reservation" du payout Hospitable, en centimes). Permet de créditer chaque résa
-- de SON montant quand un payout réel (avec ajustement de résolution, recouche
-- facturée via Airbnb, ou payout fractionné) est rapproché d'un mouvement bancaire.
alter table payout_reservation add column if not exists amount_cents integer;
