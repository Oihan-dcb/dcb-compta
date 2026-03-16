/**
 * Service de rapprochement bancaire DCB — Sprint B
 *
 * Logique par canal :
 * - airbnb  : montant exact ou subset sum (plusieurs VIR → 1 virement groupé)
 * - booking : montant exact ou subset sum
 * - stripe  : 1 virement mensuel = somme VIR stripe du mois
 * - sepa_manuel / direct : matching manuel uniquement
 */
import { supabase } from '../lib/supabase'

// ── LECTURE ────────────────────────────────────────────────────

export async function getMouvementsMois(mois) {
  const { data, error } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
    .order('date_operation', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getVirNonRapproches(mois) {
  const { data, error } = await supabase
    .from('ventilation')
    .select(`
      id, code, montant_ttc, mouvement_id,
      reservation (id, code, platform, guest_name, arrival_date, departure_date,
        bien (code, hospitable_name))
    `)
    .eq('code', 'VIR')
    .eq('mois_comptable', mois)
    .is('mouvement_id', null)
  if (error) throw error
  return data || []
}

export async function getStatsRapprochement(mois) {
  const [{ data: m }, { data: v }] = await Promise.all([
    supabase.from('mouvement_bancaire').select('statut_matching,credit,debit,canal').eq('mois_releve', mois),
    supabase.from('ventilation').select('montant_ttc,mouvement_id').eq('mois_comptable', mois).eq('code', 'VIR'),
  ])
  const mouvements = m || [], virs = v || []
  return {
    total_mouvements: mouvements.length,
    rapproches: mouvements.filter(x => x.statut_matching === 'rapproche').length,
    en_attente: mouvements.filter(x => x.statut_matching === 'en_attente').length,
    non_identifie: mouvements.filter(x => x.statut_matching === 'non_identifie').length,
    total_entrees: mouvements.filter(x => x.credit > 0).reduce((s, x) => s + (x.credit || 0), 0),
    total_sorties: mouvements.filter(x => x.debit > 0).reduce((s, x) => s + (x.debit || 0), 0),
    vir_total: virs.length,
    vir_rapproches: virs.filter(x => x.mouvement_id).length,
  }
}

// ── MATCHING AUTO ──────────────────────────────────────────────

export async function lancerMatchingAuto(mois) {
  const log = { matched: 0, skipped: 0, errors: 0, details: [] }
  try {
    const [mouvements, virs] = await Promise.all([getMouvementsMois(mois), getVirNonRapproches(mois)])
    const libres = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit || 0) > 0)

    // Airbnb + Booking
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)
      const virCanal = virs.filter(v => v.reservation?.platform === canal)
      for (const mouv of mouvCanal) {
        const exact = virCanal.find(v => v.montant_ttc === mouv.credit)
        if (exact) {
          await _lier(mouv.id, [exact.id])
          log.matched++
          log.details.push({ type: canal + '_exact', montant: mouv.credit / 100, resa: exact.reservation?.code })
          virCanal.splice(virCanal.indexOf(exact), 1)
          continue
        }
        const subset = _subsetSum(virCanal, mouv.credit)
        if (subset) {
          await _lier(mouv.id, subset.map(v => v.id))
          log.matched++
          log.details.push({ type: canal + '_groupe', montant: mouv.credit / 100, nb: subset.length })
          subset.forEach(v => virCanal.splice(virCanal.indexOf(v), 1))
          continue
        }
        log.skipped++
      }
    }

    // Stripe — 1 virement mensuel
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    const virStripe = virs.filter(v => v.reservation?.platform === 'stripe')
    if (mouvStripe.length === 1 && virStripe.length > 0) {
      const total = virStripe.reduce((s, v) => s + v.montant_ttc, 0)
      if (Math.abs(mouvStripe[0].credit - total) <= 100) {
        await _lier(mouvStripe[0].id, virStripe.map(v => v.id))
        log.matched++
        log.details.push({ type: 'stripe_mensuel', montant: mouvStripe[0].credit / 100, nb: virStripe.length })
      } else {
        log.skipped++
      }
    }

  } catch (err) {
    log.errors++
    console.error('Erreur matching auto:', err)
  }
  return log
}

// ── MATCHING MANUEL ────────────────────────────────────────────

export async function matcherManuellement(mouvementId, virIds) {
  await _lier(mouvementId, virIds, 'rapproche')
}

export async function marquerNonIdentifie(mouvementId) {
  const { error } = await supabase
    .from('mouvement_bancaire')
    .update({ statut_matching: 'non_identifie' })
    .eq('id', mouvementId)
  if (error) throw error
}

export async function annulerRapprochement(mouvementId) {
  const { data: virs } = await supabase
    .from('ventilation')
    .select('id, reservation_id')
    .eq('mouvement_id', mouvementId)
  if (virs?.length) {
    await supabase.from('ventilation').update({ mouvement_id: null }).in('id', virs.map(v => v.id))
    const resaIds = [...new Set(virs.map(v => v.reservation_id).filter(Boolean))]
    if (resaIds.length) await supabase.from('reservation').update({ rapprochee: false }).in('id', resaIds)
  }
  await supabase.from('mouvement_bancaire').update({ statut_matching: 'en_attente' }).eq('id', mouvementId)
}

// ── HELPERS PRIVÉS ─────────────────────────────────────────────

async function _lier(mouvementId, virIds, statut = 'rapproche') {
  await supabase.from('ventilation').update({ mouvement_id: mouvementId }).in('id', virIds)
  await supabase.from('mouvement_bancaire').update({ statut_matching: statut }).eq('id', mouvementId)
  const { data: v } = await supabase.from('ventilation').select('reservation_id').in('id', virIds)
  if (v?.length) {
    const ids = [...new Set(v.map(x => x.reservation_id).filter(Boolean))]
    if (ids.length) await supabase.from('reservation').update({ rapprochee: true }).in('id', ids)
  }
}

// Subset sum récursif — trouve n VIR dont la somme = cible ± tol centimes
function _subsetSum(virs, cible, tol = 2) {
  const s = [...virs].sort((a, b) => b.montant_ttc - a.montant_ttc).slice(0, 9)
  function f(i, r, sel) {
    if (Math.abs(r) <= tol) return sel
    if (i >= s.length || r < -tol || sel.length >= 6) return null
    return f(i + 1, r - s[i].montant_ttc, [...sel, s[i]]) || f(i + 1, r, sel)
  }
  const res = f(0, Math.round(cible), [])
  return res && res.length > 1 ? res : null
}
