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
  const mouvements = data || []

  // Enrichir les mouvements rapprochés via ventilation → reservation → bien
  const rapproches = mouvements.filter(m => m.statut_matching === 'rapproche')
  const infoByMouv = {}

  if (rapproches.length > 0) {
    const ids = rapproches.map(m => m.id)
    // Charger les VIR liés par batch de 100
    const BATCH = 100
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      const { data: virs } = await supabase
        .from('ventilation')
        .select(`mouvement_id, reservation (guest_name, arrival_date, departure_date, platform, fin_revenue, bien (hospitable_name, gestion_loyer, agence))`)
        .eq('code', 'VIR')
        .in('mouvement_id', chunk)
      if (virs) {
        for (const v of virs) {
          if (!v.mouvement_id || !v.reservation) continue
          if (!infoByMouv[v.mouvement_id]) {
            infoByMouv[v.mouvement_id] = { biens: [], guests: [], platform: v.reservation.platform, gestion_loyer: v.reservation.bien?.gestion_loyer, agence: v.reservation.bien?.agence, arrival_date: v.reservation.arrival_date, fin_revenue: 0, nb_resas: 0 }
          }
          const _info = infoByMouv[v.mouvement_id]
          const _bien = v.reservation.bien?.hospitable_name
          if (_bien && !_info.biens.includes(_bien)) _info.biens.push(_bien)
          if (v.reservation.guest_name && !_info.guests.includes(v.reservation.guest_name)) _info.guests.push(v.reservation.guest_name)
          _info.fin_revenue += (v.reservation.fin_revenue || 0)
          _info.nb_resas++
        }
      }
    }

    // Normaliser : bien_name et guest_name agrégés
    for (const info of Object.values(infoByMouv)) {
      info.bien_name = info.biens.join(' · ')
      info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
    }

    for (const m of rapproches) {
      m._resa = infoByMouv[m.id] || null
    }
  }

  // Marquer les débits seuls comme debit_en_attente
  for (const m of mouvements) {
    if (m.statut_matching === 'en_attente' && !(m.credit > 0) && m.debit > 0) {
      m.statut_matching = 'debit_en_attente'
    }
  }

  return mouvements
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
    supabase.from('ventilation').select('montant_ttc,mouvement_id').eq('mois_comptable', mois).eq('code', 'VIR').not('bien_id', 'is', null),
  ])
  const mouvements = m || [], virs = v || []
  return {
    total_mouvements: mouvements.length,
    rapproches: mouvements.filter(x => x.statut_matching === 'rapproche').length,
    en_attente: mouvements.filter(x => x.statut_matching === 'en_attente' && (x.credit || 0) > 0).length,
    non_identifie: mouvements.filter(x => x.statut_matching === 'non_identifie').length,
    total_entrees: mouvements.filter(x => x.credit > 0).reduce((s, x) => s + (x.credit || 0), 0),
    total_sorties: mouvements.filter(x => x.debit > 0).reduce((s, x) => s + (x.debit || 0), 0),
    vir_total: virs.length,
    vir_rapproches: virs.filter(x => x.mouvement_id !== null).length,
    vir_montant_total: virs.reduce((s,v) => s + (v.montant_ttc || 0), 0),
  }
}

// ── MATCHING AUTO ──────────────────────────────────────────────

export async function lancerMatchingAuto(mois) {
  const log = { matched: 0, skipped: 0, errors: 0, details: [] }

  try {
    // Mouvements du mois en attente avec entrée (credit > 0)
    const mouvements = await getMouvementsMois(mois)
    const libres = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit || 0) > 0)

    // VIR non rapprochés du mois
    const virs = await getVirNonRapproches(mois)

    // Charger TOUS les payouts sans mouvement (pas de filtre par date)
    // Les payouts Hospitable peuvent dater de n importe quand
    // On pagine par 1000 pour tout récupérer
    let payoutsAll = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data: page } = await supabase
        .from('payout_hospitable')
        .select('id, amount, platform, date_payout, mouvement_id')
        .is('mouvement_id', null)
        .range(from, from + PAGE - 1)
      if (!page || page.length === 0) break
      payoutsAll.push(...page)
      if (page.length < PAGE) break
      from += PAGE
    }

    // ── AIRBNB + BOOKING ───────────────────────────────────────────
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)
      const payoutsCanal = payoutsAll.filter(p => p.platform === canal)
      const virCanal = virs.filter(v => v.reservation?.platform === canal)

      for (const mouv of mouvCanal) {

        // Étape 1 : montant exact (1 payout = 1 mouvement) — cas principal ~99%
        const payoutExact = payoutsCanal.find(p => Math.abs(p.amount - mouv.credit) <= 2)

        if (payoutExact) {
          await supabase.from('payout_hospitable')
            .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
            .eq('id', payoutExact.id)

          // Chercher les VIR via payout_reservation
          let virIds = []
          const { data: prLinks } = await supabase
            .from('payout_reservation')
            .select('reservation_id')
            .eq('payout_id', payoutExact.id)
          if (prLinks?.length) {
            const resaIds = prLinks.map(r => r.reservation_id)
            const matched = virCanal.filter(v => resaIds.includes(v.reservation?.id))
            if (matched.length) virIds = matched.map(v => v.id)
          }

          // Fallback VIR : montant exact sur VIR
          if (virIds.length === 0) {
            const exact = virCanal.find(v => !v.mouvement_id && Math.abs(v.montant_ttc - mouv.credit) <= 2)
            if (exact) virIds = [exact.id]
          }

          // Fallback VIR : subset sum
          if (virIds.length === 0) {
            const subset = _subsetSum(virCanal.filter(v => !v.mouvement_id), mouv.credit)
            if (subset) virIds = subset.map(v => v.id)
          }

          if (virIds.length > 0) {
            await _lier(mouv.id, virIds)
          } else {
            await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche' })
              .eq('id', mouv.id)
          }

          payoutsCanal.splice(payoutsCanal.indexOf(payoutExact), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal + '_exact', montant: mouv.credit / 100, nb_virs: virIds.length })
          continue
        }

        // Étape 2 : regroupement — N payouts → 1 mouvement (Airbnb groupe par compte)
        const subsetPay = _subsetSum(payoutsCanal, mouv.credit, 2)
        if (subsetPay) {
          for (const p of subsetPay) {
            await supabase.from('payout_hospitable')
              .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
              .eq('id', p.id)
          }

          let virIds = []
          const allResaIds = []
          for (const p of subsetPay) {
            const { data: prLinks } = await supabase
              .from('payout_reservation').select('reservation_id').eq('payout_id', p.id)
            if (prLinks?.length) allResaIds.push(...prLinks.map(r => r.reservation_id))
          }
          if (allResaIds.length) {
            const matched = virCanal.filter(v => !v.mouvement_id && allResaIds.includes(v.reservation?.id))
            if (matched.length) virIds = matched.map(v => v.id)
          }
          if (virIds.length === 0) {
            const subset = _subsetSum(virCanal.filter(v => !v.mouvement_id), mouv.credit)
            if (subset) virIds = subset.map(v => v.id)
          }

          if (virIds.length > 0) {
            await _lier(mouv.id, virIds)
          } else {
            await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche' })
              .eq('id', mouv.id)
          }

          for (const p of subsetPay) payoutsCanal.splice(payoutsCanal.indexOf(p), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal + '_groupe', montant: mouv.credit / 100, nb_payouts: subsetPay.length, nb_virs: virIds.length })
          continue
        }

        log.skipped++
      }
    }

    // ── STRIPE ─────────────────────────────────────────────────────
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    const virStripe = virs.filter(v => v.reservation?.platform === 'stripe' && !v.mouvement_id)
    for (const mouv of mouvStripe) {
      const exact = virStripe.find(v => Math.abs(v.montant_ttc - mouv.credit) <= 2)
      if (exact) {
        await _lier(mouv.id, [exact.id])
        log.matched++
        log.details.push({ type: 'stripe_exact', montant: mouv.credit / 100 })
        continue
      }
      const total = virStripe.reduce((s, v) => s + v.montant_ttc, 0)
      if (total > 0 && Math.abs(total - mouv.credit) / mouv.credit < 0.05) {
        await _lier(mouv.id, virStripe.map(v => v.id))
        log.matched++
        log.details.push({ type: 'stripe_total', montant: mouv.credit / 100, nb_virs: virStripe.length })
        continue
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
