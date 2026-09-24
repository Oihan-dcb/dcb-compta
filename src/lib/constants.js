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
// 'not accepted declined' / 'not accepted expired' : sync-reservations.js concatène
// category+sub_category quand ils diffèrent (`${category} ${sub_category}`, cf. fix
// checkpoint_voided du 06/09/2026) — Hospitable renvoie ces deux combos en plus du
// 'checkpoint voided' déjà couvert. Trouvé le 07/09/2026 : 15 résas (8+7) invisibles à ce
// filtre, dont Jacques Gistal/Villa Bacalan affichée à tort "non ventilée" (0€, refusée,
// rien à ventiler) dans buildComptaMensuelle. Vérifié à l'échelle de toute la base : ce
// sont les 2 seuls combos category+sub_category actuellement produits hors de cette liste.
export const STATUTS_NON_VENTILABLES = [
  'cancelled',
  'not_accepted',
  'not accepted',
  'not accepted declined',
  'not accepted expired',
  'declined',
  'expired',
  'checkpoint',
  'checkpoint voided',
  'request',
  // Résa supprimée côté Hospitable (24/09/2026, demande Oïhan) : jamais effacée de la base —
  // on garde l'historique — mais passée 'deleted' + fin_revenue=0 par sync-reservations,
  // uniquement après un 404 explicite de l'API sur la résa elle-même (cf. marquerSupprimee).
  'deleted',
]
