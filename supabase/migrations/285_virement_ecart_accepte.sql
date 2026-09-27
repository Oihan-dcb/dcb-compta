-- Migration 285 (27/09/2026) : écart virement/facture accepté par Oïhan (geste commercial, écart
-- compensé hors facture…). Le badge Virement affiche « ✓ écart accepté » tant que l'écart courant
-- est égal à l'écart accepté (ecart_accepte_cts) ; si le calcul change, l'alerte revient.
-- Colonnes jamais écrites par verify-virements-sortants (son upsert ne les contient pas).
ALTER TABLE public.virement_sortant_controle
  ADD COLUMN IF NOT EXISTS ecart_accepte_cts  integer,
  ADD COLUMN IF NOT EXISTS ecart_accepte_note text,
  ADD COLUMN IF NOT EXISTS ecart_accepte_par  text,
  ADD COLUMN IF NOT EXISTS ecart_accepte_le   timestamptz;
