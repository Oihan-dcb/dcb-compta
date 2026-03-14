/**
 * Service de matching bancaire — Sprint S2
 *
 * Logique de rapprochement par canal :
 * - Booking  : référence payout = NO.{ref} dans libellé CE → match exact
 * - Airbnb   : montant ±0.02€ + date ±3j, avec subset sum si groupé
 * - Stripe   : 1 virement mensuel → match par mois + montant
 * - SEPA     : montant exact + nom dans détail
 */

import { supabase } from '../lib/supabase'
import { fetchPayouts } from '../lib/hospitable'

// ============================================================
// SYNC PAYOUTS HOSPITABLE → SUPABASE
// ============================================================

/**
 * Synchronise les payouts Hospitable dans la table payout_hospitable
 * @param {string} mois - YYYY-MM
 */
export async function syncPayouts(mois) {
  const log = { created: 0, updated: 0, errors: 0, total: 0 }

  try {
    // Récupérer les payouts du mois depuis Hospitable
    const [year, month] = mois.split('-').map(Number)
    const startDate = `${mois}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${mois}-${String(lastDay).padStart(2, '0')}`

    const payouts = await fetchPayouts({ startDate, endDate })
    log.total = payouts.length

    if (payouts.length === 0) {
      // Fallback : récupérer tous et filtrer côté client
      // L'API Hospitable ne supporte pas forcément le filtre par date sur /payouts
      const allPayouts = await fetchPayouts({})
      const filtered = allPayouts.filter(p => {
        const d = (p.date || p.date_payout || '').substring(0, 7)
        return d === mois
      })
      return syncPayoutsData(filtered, mois, log)
    }

    return syncPayoutsData(payouts, mois, log)
  } catch (err) {
    console.error('Erreur sync payouts:', err)
    await supabase.from('import_log').insert({
      type: 'hospitable_payouts', mois_concerne: mois,
      statut: 'error', nb_erreurs: 1, message: err.message,
    })
    throw err
  }
}

async function syncPayoutsData(payouts, mois, log) {
  // Récupérer les payouts existants
  const { data: existing } = await supabase
    .from('payout_hospitable')
    .select('id, hospitable_id')
    .eq('mois_comptable', mois)

  const existingMap = new Map((existing || []).map(p => [p.hospitable_id, p]))

  const toUpsert = payouts.map(p => ({
    hospitable_id: p.id,
    platform: p.platform,
    platform_id: p.platform_id || null,
    reference: p.reference || null,
    amount: p.amount?.amount ?? 0,
    date_payout: (p.date || p.date_payout || '').substring(0, 10),
    bank_account: p.bank_account || null,
    mois_comptable: mois,
    statut_matching: 'en_attente',
  }))

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from('payout_hospitable')
      .upsert(toUpsert, { onConflict: 'hospitable_id', ignoreDuplicates: false })

    if (error) throw error
  }

  log.created = toUpsert.filter(p => !existingMap.has(p.hospitable_id)).length
  log.updated = toUpsert.filter(p => existingMap.has(p.hospitable_id)).length

  await supabase.from('import_log').insert({
    type: 'hospitable_payouts', mois_concerne: mois,
    statut: 'success',
    nb_lignes_traitees: log.total,
    nb_lignes_creees: log.created,
    nb_lignes_mises_a_jour: log.updated,
    message: `Sync payouts ${mois} — ${log.created} créés, ${log.updated} mis à jour`,
  })

  return log
}

// ============================================================
// MOTEUR DE MATCHING BANCAIRE
// ============================================================

/**
 * Lance le matching automatique pour tous les mouvements entrants
 * non rapprochés d'un mois donné
 *
 * @param {string} mois - YYYY-MM
 * @returns {Promise<{matched, unmatched, errors}>}
 */
export async function lancerMatching(mois) {
  const result = { matched: 0, unmatched: 0, errors: 0 }

  // Récupérer les mouvements entrants en attente
  const { data: mouvements, error: mvtErr } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
    .eq('statut_matching', 'en_attente')
    .not('credit', 'is', null)
    .gt('credit', 5) // Ignorer les virements test < 0.05€

  if (mvtErr) throw mvtErr

  // Récupérer les payouts Hospitable du mois non matchés
  const { data: payouts, error: pErr } = await supabase
    .from('payout_hospitable')
    .select('*')
    .eq('mois_comptable', mois)
    .eq('statut_matching', 'en_attente')

  if (pErr) throw pErr

  // Récupérer les réservations du mois non rapprochées
  const { data: reservations, error: rErr } = await supabase
    .from('reservation')
    .select('id, code, platform, fin_revenue, arrival_date, guest_name')
    .eq('mois_comptable', mois)
    .eq('rapprochee', false)
    .eq('owner_stay', false)

  if (rErr) throw rErr

  // Matcher chaque mouvement
  for (const mvt of (mouvements || [])) {
    try {
      const matchResult = await matcherMouvement(mvt, payouts || [], reservations || [])
      if (matchResult.matched) {
        result.matched++
      } else {
        result.unmatched++
      }
    } catch (err) {
      console.error(`Erreur matching mouvement ${mvt.id}:`, err)
      result.errors++
    }
  }

  return result
}

/**
 * Tente de matcher un mouvement bancaire avec un ou plusieurs payouts/réservations
 */
async function matcherMouvement(mvt, payouts, reservations) {
  const canal = mvt.canal

  // --- Booking : match par référence ---
  if (canal === 'booking') {
    return matcherBooking(mvt, payouts)
  }

  // --- Stripe : match par mois + montant ---
  if (canal === 'stripe') {
    return matcherStripe(mvt, payouts)
  }

  // --- Airbnb : match par montant + date, avec subset sum ---
  if (canal === 'airbnb') {
    return matcherAirbnb(mvt, payouts)
  }

  // --- SEPA manuel : match par montant exact + nom ---
  if (canal === 'sepa_manuel') {
    return matcherSepa(mvt, reservations)
  }

  return { matched: false, raison: 'Canal non géré : ' + canal }
}

// ============================================================
// MATCHERS PAR CANAL
// ============================================================

/**
 * Booking : extrait la référence du libellé CE et cherche le payout correspondant
 * Libellé CE : "NO.P2CHcbU2X61HOcYD/ID.10415482"
 */
async function matcherBooking(mvt, payouts) {
  // Extraire la référence depuis le détail bancaire
  // Format : NO.{reference}/ID.{property_id}
  const detail = mvt.detail || mvt.libelle || ''
  const refMatch = detail.match(/NO\.([A-Za-z0-9]+)/)
  if (!refMatch) return { matched: false, raison: 'Référence Booking introuvable dans libellé' }

  const ref = refMatch[1]

  // Chercher dans les payouts Hospitable
  const payout = payouts.find(p =>
    p.platform === 'booking' &&
    p.reference === ref &&
    p.statut_matching === 'en_attente'
  )

  if (!payout) {
    // Chercher aussi dans Supabase si pas encore en mémoire
    const { data: found } = await supabase
      .from('payout_hospitable')
      .select('*')
      .eq('reference', ref)
      .eq('platform', 'booking')
      .single()

    if (!found) return { matched: false, raison: `Payout Booking ref=${ref} non trouvé` }

    return confirmerMatch(mvt, [found], 'matche_auto', `Booking ref ${ref}`)
  }

  return confirmerMatch(mvt, [payout], 'matche_auto', `Booking ref ${ref}`)
}

/**
 * Stripe : 1 virement mensuel → match sur mois + montant total
 */
async function matcherStripe(mvt, payouts) {
  const mois = mvt.mois_releve

  // Chercher payouts Stripe du mois avec montant proche
  const stripePayout = payouts.find(p =>
    p.platform === 'direct' || p.platform === 'stripe' ||
    (p.platform_id && p.bank_account?.toLowerCase().includes('stripe'))
  )

  if (!stripePayout) {
    // Chercher dans Supabase par mois et montant approché
    const { data: found } = await supabase
      .from('payout_hospitable')
      .select('*')
      .eq('mois_comptable', mois)
      .gte('amount', mvt.credit - 200)    // ±2€ de tolérance
      .lte('amount', mvt.credit + 200)
      .eq('statut_matching', 'en_attente')
      .limit(1)
      .single()

    if (!found) return { matched: false, raison: 'Payout Stripe non trouvé pour ce mois' }
    return confirmerMatch(mvt, [found], 'matche_auto', `Stripe ${mois}`)
  }

  // Vérifier que le montant correspond (tolérance ±5€ car frais Stripe variables)
  if (Math.abs(stripePayout.amount - mvt.credit) <= 500) {
    return confirmerMatch(mvt, [stripePayout], 'matche_auto', 'Stripe mensuel')
  }

  return { matched: false, raison: `Stripe : montant CE ${mvt.credit} ≠ payout ${stripePayout.amount}` }
}

/**
 * Airbnb : match par montant ±2 centimes + date ±3 jours
 * Si pas de match simple → tente subset sum sur les payouts non matchés
 */
async function matcherAirbnb(mvt, payouts) {
  const montant = mvt.credit
  const dateMvt = new Date(mvt.date_operation)

  // Filtrer les payouts Airbnb non matchés
  const airbnbPayouts = payouts.filter(p => p.platform === 'airbnb' && p.statut_matching === 'en_attente')

  // Tentative 1 : match direct (1 payout = 1 virement)
  const matchDirect = airbnbPayouts.find(p => {
    const ecartMontant = Math.abs(p.amount - montant) <= 2
    const datePayout = new Date(p.date_payout)
    const ecartJours = Math.abs((datePayout - dateMvt) / (1000 * 60 * 60 * 24))
    return ecartMontant && ecartJours <= 3
  })

  if (matchDirect) {
    return confirmerMatch(mvt, [matchDirect], 'matche_auto', `Airbnb direct ${matchDirect.amount}c`)
  }

  // Tentative 2 : subset sum (virement groupé)
  const subsetResult = subsetSum(airbnbPayouts, montant, dateMvt)

  if (subsetResult.found) {
    if (subsetResult.combinations.length === 1) {
      // Combinaison unique → match automatique
      return confirmerMatch(mvt, subsetResult.combinations[0], 'matche_auto',
        `Airbnb groupé (${subsetResult.combinations[0].length} résa)`)
    } else {
      // Plusieurs combinaisons possibles → proposer à la validation manuelle
      await supabase.from('mouvement_bancaire').update({
        statut_matching: 'en_attente',
        // Stocker les propositions dans un champ JSON pour l'interface
      }).eq('id', mvt.id)

      return { matched: false, raison: `Airbnb : ${subsetResult.combinations.length} combinaisons possibles — validation manuelle requise`, propositions: subsetResult.combinations }
    }
  }

  return { matched: false, raison: `Airbnb : aucun payout correspondant à ${montant}c (±2c, ±3j)` }
}

/**
 * SEPA manuel : match sur montant exact + recherche nom dans détail
 */
async function matcherSepa(mvt, reservations) {
  const montant = mvt.credit
  const detail = (mvt.detail || '').toLowerCase()

  // Chercher une réservation avec revenue = montant ±5c (variations possibles)
  const match = reservations.find(r => {
    const ecartMontant = Math.abs((r.fin_revenue || 0) - montant) <= 5
    if (!ecartMontant) return false

    // Si on a un nom dans le détail, vérifier qu'il correspond
    if (detail && r.guest_name) {
      const nomNorm = r.guest_name.toLowerCase().split(' ')
      const nomDansDetail = nomNorm.some(n => n.length > 2 && detail.includes(n))
      return nomDansDetail
    }

    return ecartMontant
  })

  if (match) {
    // Créer un payout virtuel pour les réservations manuelles
    const { data: payout } = await supabase
      .from('payout_hospitable')
      .insert({
        hospitable_id: `manual_${mvt.id}`,
        platform: 'manual',
        amount: montant,
        date_payout: mvt.date_operation,
        mois_comptable: mvt.mois_releve,
        statut_matching: 'en_attente',
      })
      .select()
      .single()

    if (payout) {
      // Lier à la réservation
      await supabase.from('payout_reservation').insert({
        payout_id: payout.id,
        reservation_id: match.id,
      })
    }

    // Marquer le mouvement et la réservation
    await Promise.all([
      supabase.from('mouvement_bancaire').update({
        statut_matching: 'matche_auto',
      }).eq('id', mvt.id),
      supabase.from('reservation').update({ rapprochee: true })
        .eq('id', match.id),
    ])

    return { matched: true, raison: `SEPA manuel — ${match.code}` }
  }

  return { matched: false, raison: `SEPA : aucune réservation à ${montant}c` }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Confirme un match entre un mouvement et une liste de payouts
 * Met à jour les statuts dans Supabase
 */
async function confirmerMatch(mvt, matchedPayouts, statut, note) {
  const payoutIds = matchedPayouts.map(p => p.id)
  const reservationIds = []

  // Récupérer toutes les réservations liées à ces payouts
  for (const payoutId of payoutIds) {
    const { data: liens } = await supabase
      .from('payout_reservation')
      .select('reservation_id')
      .eq('payout_id', payoutId)

    if (liens) reservationIds.push(...liens.map(l => l.reservation_id))
  }

  // Mettre à jour le mouvement bancaire
  await supabase.from('mouvement_bancaire').update({
    statut_matching: statut,
  }).eq('id', mvt.id)

  // Mettre à jour les payouts
  if (payoutIds.length > 0) {
    await supabase.from('payout_hospitable')
      .update({ statut_matching: statut, mouvement_id: mvt.id })
      .in('id', payoutIds)
  }

  // Marquer les réservations comme rapprochées
  if (reservationIds.length > 0) {
    await supabase.from('reservation')
      .update({ rapprochee: true })
      .in('id', reservationIds)

    // Lier les réservations au mouvement dans la ventilation
    await supabase.from('ventilation')
      .update({ mouvement_id: mvt.id })
      .in('reservation_id', reservationIds)
  }

  return { matched: true, raison: note, payoutIds, reservationIds }
}

/**
 * Algorithme subset sum pour les virements Airbnb groupés
 * Cherche toutes les combinaisons de payouts dont la somme = montant cible ±2 centimes
 *
 * @param {Array} payouts - Payouts Airbnb disponibles
 * @param {number} cible - Montant cible en centimes
 * @param {Date} dateMvt - Date du virement
 * @param {number} maxItems - Limite pour éviter explosion combinatoire
 * @returns {{ found: boolean, combinations: Array[][] }}
 */
function subsetSum(payouts, cible, dateMvt, maxItems = 8) {
  const TOLERANCE = 2 // ±2 centimes
  const MAX_JOURS = 7 // fenêtre temporelle élargie pour les groupés

  // Filtrer les payouts dans la fenêtre temporelle
  const candidats = payouts.filter(p => {
    const dp = new Date(p.date_payout)
    const ecartJours = Math.abs((dp - dateMvt) / (1000 * 60 * 60 * 24))
    return ecartJours <= MAX_JOURS
  })

  if (candidats.length === 0) return { found: false, combinations: [] }
  if (candidats.length > maxItems) {
    // Trop de candidats — limiter aux plus proches en date
    candidats.sort((a, b) => {
      const da = Math.abs(new Date(a.date_payout) - dateMvt)
      const db = Math.abs(new Date(b.date_payout) - dateMvt)
      return da - db
    })
    candidats.splice(maxItems)
  }

  const combinations = []

  // Backtracking pour trouver toutes les combinaisons valides
  function backtrack(start, current, currentSum) {
    if (Math.abs(currentSum - cible) <= TOLERANCE) {
      if (current.length >= 2) { // Un groupé a au moins 2 payouts
        combinations.push([...current])
        if (combinations.length >= 5) return // Limiter à 5 propositions
      }
    }

    if (currentSum > cible + TOLERANCE) return // Pruning
    if (combinations.length >= 5) return

    for (let i = start; i < candidats.length; i++) {
      current.push(candidats[i])
      backtrack(i + 1, current, currentSum + candidats[i].amount)
      current.pop()
    }
  }

  backtrack(0, [], 0)

  return { found: combinations.length > 0, combinations }
}

// ============================================================
// VALIDATION MANUELLE
// ============================================================

/**
 * Confirme manuellement un match entre un mouvement et des payouts
 * @param {string} mouvementId
 * @param {string[]} payoutIds
 */
export async function validerMatchManuellement(mouvementId, payoutIds) {
  // Récupérer le mouvement
  const { data: mvt } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('id', mouvementId)
    .single()

  if (!mvt) throw new Error('Mouvement introuvable')

  // Récupérer les payouts
  const { data: payouts } = await supabase
    .from('payout_hospitable')
    .select('*')
    .in('id', payoutIds)

  if (!payouts || payouts.length === 0) throw new Error('Payouts introuvables')

  return confirmerMatch(mvt, payouts, 'matche_manuel', 'Validation manuelle')
}

/**
 * Marque un mouvement comme non rapprochable (transfert interne, frais...)
 */
export async function marquerNonRapprochable(mouvementId) {
  const { error } = await supabase
    .from('mouvement_bancaire')
    .update({ statut_matching: 'non_rapprochable' })
    .eq('id', mouvementId)

  if (error) throw error
}

// ============================================================
// LECTURE
// ============================================================

export async function getPayoutsMois(mois) {
  const { data, error } = await supabase
    .from('payout_hospitable')
    .select('*')
    .eq('mois_comptable', mois)
    .order('date_payout')

  if (error) throw error
  return data || []
}

export async function getMatchingStats(mois) {
  const { data: mvts } = await supabase
    .from('mouvement_bancaire')
    .select('statut_matching, credit')
    .eq('mois_releve', mois)
    .not('credit', 'is', null)
    .gt('credit', 5)

  const stats = { total: 0, auto: 0, manuel: 0, en_attente: 0, non_rapprochable: 0 }
  for (const m of (mvts || [])) {
    stats.total++
    if (m.statut_matching === 'matche_auto') stats.auto++
    else if (m.statut_matching === 'matche_manuel') stats.manuel++
    else if (m.statut_matching === 'en_attente') stats.en_attente++
    else if (m.statut_matching === 'non_rapprochable') stats.non_rapprochable++
  }
  stats.taux = stats.total > 0 ? Math.round((stats.auto + stats.manuel) / stats.total * 100) : 0
  return stats
}
