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

    // Charger payouts du mois (filtrés par date_payout)
    const [year, month] = mois.split('-').map(Number)
    const dateStart = mois + '-01'
    const lastDay = new Date(year, month, 0).getDate()
    const dateEnd = mois + '-' + String(lastDay).padStart(2, '0')
    const { data: payouts } = await supabase
      .from('payout_hospitable')
      .select('id, amount, platform, mois_comptable, mouvement_id, date_payout')
      .gte('date_payout', dateStart)
      .lte('date_payout', dateEnd)
      .is('mouvement_id', null)

    const payoutsLibres = payouts || []

    // ── HELPER : extraire checkin du detail ────────────────────────
    function extractCheckin(detail) {
      if (!detail) return null
      const m = detail.match(/checkin:(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{2})/)
      if (!m) return null
      const s = m[1]
      if (s.includes('/')) {
        const p = s.split('/')
        if (p[2].length === 2) return '20' + p[2] + '-' + p[1] + '-' + p[0]
        return p[2] + '-' + p[1] + '-' + p[0]
      }
      return s
    }

    function datesDiff(a, b) {
      return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000
    }

    // ── AIRBNB + BOOKING : matching multi-stratégies ───────────────
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)
      const payoutsCanal = payoutsLibres.filter(p => p.platform === canal)
      const virCanal = virs.filter(v => v.reservation?.platform === canal)

      for (const mouv of mouvCanal) {
        // 1. Trouver le payout par montant (±2 centimes)
        const payout = payoutsCanal.find(p => Math.abs(p.amount - mouv.credit) <= 2)

        if (payout) {
          // Lier mouvement au payout
          await supabase.from('payout_hospitable')
            .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
            .eq('id', payout.id)

          const virsCible = virCanal.filter(v => !v.mouvement_id)
          let virIds = []

          // Stratégie A : via payout_reservation
          if (virIds.length === 0) {
            const { data: prLinks } = await supabase
              .from('payout_reservation')
              .select('reservation_id')
              .eq('payout_id', payout.id)
            if (prLinks?.length) {
              const resaIds = prLinks.map(r => r.reservation_id)
              const matched = virsCible.filter(v => resaIds.includes(v.reservation?.id))
              if (matched.length) virIds = matched.map(v => v.id)
            }
          }

          // Stratégie B : checkin extrait du detail (NOUVEAU - prioritaire)
          if (virIds.length === 0 && mouv.detail) {
            const checkin = extractCheckin(mouv.detail)
            if (checkin) {
              const byDetail = virsCible.filter(v => {
                const arr = v.reservation?.arrival_date
                return arr && datesDiff(arr, checkin) <= 1
              })
              if (byDetail.length > 0) virIds = byDetail.map(v => v.id)
            }
          }

          // Stratégie C : arrival_date ≈ date_operation ±5j (élargi de 2j à 5j)
          if (virIds.length === 0) {
            const mouvDate = mouv.date_operation
            const byCheckin = virsCible.filter(v => {
              const arr = v.reservation?.arrival_date
              return arr && datesDiff(arr, mouvDate) <= 5
            })
            // 1 seul VIR → lier directement (sans contrainte de somme)
            if (byCheckin.length === 1) {
              virIds = byCheckin.map(v => v.id)
            } else if (byCheckin.length > 1) {
              // Plusieurs → vérifier que la somme = montant ±10%
              const sum = byCheckin.reduce((s, v) => s + v.montant_ttc, 0)
              if (Math.abs(sum - mouv.credit) / mouv.credit < 0.10) {
                virIds = byCheckin.map(v => v.id)
              }
            }
          }

          // Stratégie D : exact ou subset sum sur montant
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
            await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche' })
              .eq('id', mouv.id)
          }

          payoutsCanal.splice(payoutsCanal.indexOf(payout), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal, montant: mouv.credit / 100, date: mouv.date_operation, nb_virs: virIds.length })
          continue
        }

        // Pas de payout → tenter matching direct via detail (sans payout)
        if (mouv.detail) {
          const checkin = extractCheckin(mouv.detail)
          if (checkin) {
            const virsCible = virCanal.filter(v => !v.mouvement_id)
            const byDetail = virsCible.filter(v => {
              const arr = v.reservation?.arrival_date
              return arr && datesDiff(arr, checkin) <= 1
            })
            if (byDetail.length > 0) {
              await _lier(mouv.id, byDetail.map(v => v.id))
              log.matched++
              log.details.push({ type: canal + '_detail', montant: mouv.credit / 100, nb_virs: byDetail.length })
              continue
            }
          }
        }

        log.skipped++
      }
    }

    // ── STRIPE ─────────────────────────────────────────────────────
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    const virStripe = virs.filter(v => v.reservation?.platform === 'stripe')

    for (const mouv of mouvStripe) {
      // Tenter matching par detail d'abord
      if (mouv.detail) {
        const checkin = extractCheckin(mouv.detail)
        if (checkin) {
          const byDetail = virStripe.filter(v => {
            const arr = v.reservation?.arrival_date
            return arr && datesDiff(arr, checkin) <= 2
          })
          if (byDetail.length > 0) {
            await _lier(mouv.id, byDetail.map(v => v.id))
            log.matched++
            log.details.push({ type: 'stripe_detail', montant: mouv.credit / 100, nb_virs: byDetail.length })
            continue
          }
        }
      }
      // Fallback : somme totale
      const total = virStripe.reduce((s, v) => s + v.montant_ttc, 0)
      if (Math.abs(total - mouv.credit) / mouv.credit < 0.05) {
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
