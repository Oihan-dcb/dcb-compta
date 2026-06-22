// dashboardProprietaire.js — Agrégation financière annuelle par propriétaire.
//
// PRINCIPE : zéro recalcul. On boucle buildRapportData (source de vérité, par bien × mois)
// et on additionne. Le "net reversé" suit EXACTEMENT la logique de PageProprietaires
// (facture confirmée → montant_reversement ; sinon LOY − débours − haowner − frais).
//
// ⚠️ Glossaire VIR : on n'utilise JAMAIS virTotal (VIR = brut plateforme incluant la
// commission DCB). Le net proprio se dérive de LOY. Voir docs/domain-rules.md §17.

import { buildRapportData } from './buildRapportData'

const STATUTS_NON_VENTILABLES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']

// Net réellement reversable au proprio pour un (bien, mois) — même règle que PageProprietaires.
function netDuMois(data) {
  const f = data.facture
  const factureSolide = f?.montant_reversement > 0 && f?.statut !== 'brouillon' && f?.statut !== 'calcul_en_cours'
  if (factureSolide) return f.montant_reversement
  return Math.max(0,
    (data.kpis?.loyTotal || 0)
    - (data.kpis?._totalDebours || 0)
    - (data.kpis?._totalHaowner || 0)
    - (data.kpis?._fraisDeductionLoy || 0))
}

/**
 * Agrège les chiffres d'un propriétaire sur une année civile.
 * @param {object} proprio - propriétaire complet (doit contenir .bien[])
 * @param {number} annee - ex. 2026
 * @returns {Promise<{annee, total, parMois, parBien}>}
 */
export async function agregerProprietaireAnnuel(proprio, annee) {
  const biens = proprio?.bien || []
  const moisList = Array.from({ length: 12 }, (_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`)

  // Appels buildRapportData pour chaque bien × mois (source de vérité)
  const calls = biens.flatMap(bien =>
    moisList.map(mois =>
      buildRapportData(bien.id, proprio.id, mois)
        .then(data => ({ bien, mois, data }))
        .catch(() => ({ bien, mois, data: null }))
    )
  )
  const results = (await Promise.all(calls)).filter(r => r.data)

  const blank = () => ({ caHeb: 0, honTotal: 0, fmenTotal: 0, autoTotal: 0, taxe: 0, netReverse: 0, nbResas: 0, nuitsOccupees: 0 })
  const total = blank()
  const parMoisMap = Object.fromEntries(moisList.map(m => [m, { mois: m, ...blank() }]))
  const parBienMap = Object.fromEntries(biens.map(b => [b.id, { bienId: b.id, code: b.code, nom: b.hospitable_name || b.code, ...blank() }]))

  for (const { bien, mois, data } of results) {
    const k = data.kpis || {}
    const net = netDuMois(data)
    // Taxe de séjour = somme des taxes par résa ventilable (pas dans kpis)
    const taxe = (data.resas || [])
      .filter(r => !r.owner_stay && !STATUTS_NON_VENTILABLES.includes(r.final_status))
      .reduce((s, r) => s + (r.taxe || 0), 0)

    const apply = (t) => {
      t.caHeb += k.caHeb || 0
      t.honTotal += k.honTotal || 0
      t.fmenTotal += k.fmenTotal || 0
      t.autoTotal += k.autoTotal || 0
      t.taxe += taxe
      t.netReverse += net
      t.nbResas += k.nbResas || 0
      t.nuitsOccupees += k.nuitsOccupees || 0
    }
    apply(total)
    apply(parMoisMap[mois])
    if (parBienMap[bien.id]) apply(parBienMap[bien.id])
  }

  return {
    annee,
    total,
    parMois: moisList.map(m => parMoisMap[m]),
    parBien: Object.values(parBienMap).sort((a, b) => b.caHeb - a.caHeb),
  }
}
