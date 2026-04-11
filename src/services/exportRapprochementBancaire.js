/**
 * exportRapprochementBancaire(mois)
 * Wrapper autonome autour de exportCSVComptable — charge les mouvements en interne.
 * Usage : const csv = await exportRapprochementBancaire(mois)
 */
import { getMouvementsMois } from './rapprochement'
import { exportCSVComptable } from './exportCSVComptable'

export async function exportRapprochementBancaire(mois) {
  const mouvements = await getMouvementsMois(mois)
  return exportCSVComptable(mouvements, mois)
}
