/**
 * Service de rapprochement bancaire DCB — Sprint B
 *
 * Stratégie : matching par montant exact
 *   mouvement_bancaire.credit ↔ payout_hospitable.amount (±2 centimes)
 *   → lie mouvement au payout (mouvement_bancaire.statut = rapproche)
 *   → lie les VIR du même mois via subset sum si besoin
 *
 * SEPA/Direct : matching manuel — l'utilisateur choisit les VIR à lier
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
    const [mouvements, virs] = await Promise.all([
      getMouvementsMois(mois),
      getVirNonRapproches(mois),
    ])
    const libres = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit || 0) > 0)

    // Charger les payouts dont la date_payout correspond au mois du relevé bancaire
    // NB: mois_comptable = mois de la résa, pas du payout → filtrer par date_payout
    const [year, month] = mois.split('-').map(Number)
    const dateStart = `${mois}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const dateEnd = `${mois}-${String(lastDay).padStart(2,'0')}`
    const { data: payouts } = await supabase
      .from('payout_hospitable')
      .select('id, amount, platform, mois_comptable, mouvement_id, date_payout')
      .gte('date_payout', dateStart)
      .lte('date_payout', dateEnd)
      .is('mouvement_id', null)

    const payoutsLibres = payouts || []

    // ── AIRBNB + BOOKING : mouvement ↔ payout par montant ─────
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)
      const payoutsCanal = payoutsLibres.filter(p => p.platform === canal)
      const virCanal = virs.filter(v => v.reservation?.platform === canal)

      for (const mouv of mouvCanal) {
        // 1. Trouver le payout dont le montant = crédit du mouvement
        const payout = payoutsCanal.find(p => Math.abs(p.amount - mouv.credit) <= 2)

        if (payout) {
          // 2. Lier mouvement au payout
          await supabase.from('payout_hospitable')
            .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
            .eq('id', payout.id)

          // 3. Lier les VIR — 3 stratégies en cascade
          const virsCible = virCanal.filter(v => !v.mouvement_id)
          let virIds = []

          // Stratégie A : via payout_reservation (peuplé par syncPayouts)
          if (payout && virIds.length === 0) {
            const { data: prLinks } = await supabase
              .from('payout_reservation')
              .select('reservation_id')
              .eq('payout_id', payout.id)
            if (prLinks?.length) {
              const resaIds = prLinks.map(r => r.reservation_id)
              const matchedVirs = virsCible.filter(v => resaIds.includes(v.reservation?.id))
              if (matchedVirs.length) virIds = matchedVirs.map(v => v.id)
            }
          }

          // Stratégie B : arrival_date ≈ date_operation ±2j (Airbnb verse au check-in)
          if (virIds.length === 0 && mouv.date_operation) {
            const mouvDate = new Date(mouv.date_operation).getTime()
            const byCheckin = virsCible.filter(v => {
              const arr = v.reservation?.arrival_date
              if (!arr) return false
              const diff = Math.abs(new Date(arr).getTime() - mouvDate) / 86400000
              return diff <= 2
            })
            // Vérifier que la somme des VIR par checkin = montant du mouvement ±5%
            const sumCheckin = byCheckin.reduce((s, v) => s + v.montant_ttc, 0)
            if (byCheckin.length > 0 && Math.abs(sumCheckin - mouv.credit) / mouv.credit < 0.05) {
              virIds = byCheckin.map(v => v.id)
            }
          }

          // Stratégie C : exact ou subset sum sur montant
          if (virIds.length === 0) {
            const exact = virsCible.find(v => Math.abs(v.montant_ttc - mouv.credit) <= 2)
            if (exact) {
              virIds = [exact.id]
            } else {
              const subset = _subsetSum(virsCible, mouv.credit)
              if (subset) virIds = subset.map(v => v.id)
            }
          }

          if (virIds.length > 0) {
            await _lier(mouv.id, virIds)
          } else {
            // Pas de VIR trouvé mais payout matché → marquer le mouvement quand même
            await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche' })
              .eq('id', mouv.id)
          }

          // Retirer de la liste pour éviter double match
          payoutsCanal.splice(payoutsCanal.indexOf(payout), 1)
          virIds.forEach(id => { const i = virCanal.findIndex(v => v.id === id); if (i !== -1) virCanal.splice(i, 1) })

          log.matched++
          log.details.push({ type: canal, montant: mouv.credit / 100, date: mouv.date_operation, nb_virs: virIds.length })
          continue
        }

        log.skipped++
      }
    }

    // ── STRIPE ────────────────────────────────────────────────
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    const virStripe = virs.filter(v => v.reservation?.platform === 'stripe' && !v.mouvement_id)
    for (const mouv of mouvStripe) {
      const total = virStripe.reduce((s, v) => s + v.montant_ttc, 0)
      if (virStripe.length > 0 && Math.abs(mouv.credit - total) <= 100) {
        await _lier(mouv.id, virStripe.map(v => v.id))
        log.matched++
        log.details.push({ type: 'stripe', montant: mouv.credit / 100, nb_virs: virStripe.length })
        break
      }
      log.skipped++
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
  await supabase.from('payout_hospitable').update({ mouvement_id: null, statut_matching: 'en_attente' }).eq('mouvement_id', mouvementId)
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
