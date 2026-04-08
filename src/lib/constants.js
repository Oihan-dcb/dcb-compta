/**
 * Constantes métier partagées entre tous les modules DCB Compta.
 * Source unique — ne pas redéfinir ailleurs.
 */

// Statuts de réservation sans ventilation possible
// (sauf si fin_revenue > 0 — cas annulation avec frais de retenue)
export const STATUTS_NON_VENTILABLES = [
  'cancelled',
  'not_accepted',
  'not accepted',
  'declined',
  'expired',
]
