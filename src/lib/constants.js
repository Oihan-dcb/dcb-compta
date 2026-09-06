/**
 * Constantes métier partagées entre tous les modules DCB Compta.
 * Source unique — ne pas redéfinir ailleurs.
 */

// Statuts de réservation sans ventilation possible
// (sauf si fin_revenue > 0 — cas annulation avec frais de retenue)
//
// 'checkpoint'/'checkpoint voided' (vérification d'identité Airbnb jamais aboutie) et 'request'
// (demande à réserver jamais acceptée) ajoutés le 06/09/2026 (Oïhan) : trouvés en comparant les
// rapports générés en masse aux statements Hospitable — ex. "Maya" (Chambre Gaxuxa, 10-13/08),
// bloquée au checkpoint identité puis annulée, avait un base_comm non nul en base mais aucune
// ventilation, et passait quand même le filtre du tableau des séjours (gonflant le total "Base
// comm." affiché sans jamais apparaître dans le statement Hospitable réel). Vérifié à l'échelle de
// toute la base : 30 résas en 'checkpoint' (23 avec un montant non nul), 2 en 'request', 1 en
// 'checkpoint voided' — pas un cas isolé.
export const STATUTS_NON_VENTILABLES = [
  'cancelled',
  'not_accepted',
  'not accepted',
  'declined',
  'expired',
  'checkpoint',
  'checkpoint voided',
  'request',
]
