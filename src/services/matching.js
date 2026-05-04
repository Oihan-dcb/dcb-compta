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
// DEPRECATED — remplacé par lancerMatchingAuto dans rapprochement.js
// Conserver le fichier pour marquerNonRapprochable, getPayoutsMois, getMatchingStats, validerMatchManuelResas
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

  // Récupérer les réservations du mois non rapprochées + airbnb_account du bien
  const { data: reservations, error: rErr } = await supabase
    .from('reservation')
    .select('id, code, platform, fin_revenue, arrival_date, guest_name, bien(code, airbnb_account)')
    .eq('mois_comptable', mois)
    .eq('rapprochee', false)
    .eq('owner_stay', false)
    .not('final_status', 'in', '("not_accepted","not accepted","declined","expired")')

  if (rErr) throw rErr

  // Enrichir les resas avec airbnb_account pour faciliter le matching
  const resasEnrichies = (reservations || []).map(r => ({
    ...r,
    airbnb_account: r.bien?.airbnb_account || null,
    bien_code: r.bien?.code || null,
  }))

  // Matcher chaque mouvement
  for (const mvt of (mouvements || [])) {
    try {
      const matchResult = await matcherMouvement(mvt, payouts || [], resasEnrichies)
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
    return matcherBooking(mvt, payouts, reservations)
  }

  // --- Stripe : match par mois + montant ---
  if (canal === 'stripe') {
    return matcherStripe(mvt, payouts, reservations)
  }

  // --- Airbnb : match direct sur resas si pas de payouts dispo ---
  if (canal === 'airbnb') {
    return matcherAirbnb(mvt, payouts, reservations)
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
async function matcherAirbnb(mvt, payouts, reservations = []) {
  const montant = mvt.credit
  const dateMvt = new Date(mvt.date_operation)

  // --- Priorité 1 : match via payouts Hospitable si disponibles ---
  const airbnbPayouts = payouts.filter(p => p.platform === 'airbnb' && p.statut_matching === 'en_attente')

  if (airbnbPayouts.length > 0) {
    const matchDirect = airbnbPayouts.find(p => {
      const ecartMontant = Math.abs(p.amount - montant) <= 2
      const datePayout = new Date(p.date_payout)
      const ecartJours = Math.abs((datePayout - dateMvt) / (1000 * 60 * 60 * 24))
      return ecartMontant && ecartJours <= 3
    })
    if (matchDirect) {
      return confirmerMatch(mvt, [matchDirect], 'matche_auto', `Airbnb direct ${matchDirect.amount}c`)
    }
    const subsetResult = subsetSum(airbnbPayouts, montant, dateMvt)
    if (subsetResult.found && subsetResult.combinations.length === 1) {
      return confirmerMatch(mvt, subsetResult.combinations[0], 'matche_auto',
        `Airbnb groupé (${subsetResult.combinations[0].length} résa)`)
    }
  }

  // --- Priorité 2 : match direct sur réservations groupées par compte Airbnb ---
  // Toutes les resas Airbnb non rapprochées
  const airbnbResas = reservations.filter(r => r.platform === 'airbnb' && !r.rapprochee && r.fin_revenue > 0)

  // Grouper par airbnb_account (dynamique — basé sur les données en base)
  // Si un bien n'a pas de compte renseigné → groupe "null" (traité individuellement)
  const groupes = {}
  for (const r of airbnbResas) {
    const compte = r.airbnb_account || '__inconnu__'
    if (!groupes[compte]) groupes[compte] = []
    groupes[compte].push(r)
  }

  // Tentative 1 : match exact dans chaque groupe (1 resa = 1 virement)
  for (const [compte, resas] of Object.entries(groupes)) {
    const resaDirecte = resas.find(r => Math.abs((r.fin_revenue || 0) - montant) <= 2)
    if (resaDirecte) {
      return confirmerMatchResa(mvt, [resaDirecte], 'matche_auto',
        `Airbnb resa directe ${resaDirecte.code}${compte !== '__inconnu__' ? ' ['+compte+']' : ''}`)
    }
  }

  // Tentative 2 : subset sum dans chaque groupe (virement groupé = N resas du même compte)
  for (const [compte, resas] of Object.entries(groupes)) {
    if (resas.length < 2) continue // pas assez de resas pour un groupé
    const subsetResas = subsetSumResas(resas, montant)
    if (subsetResas.found && subsetResas.resas.length > 0) {
      return confirmerMatchResa(mvt, subsetResas.resas, 'matche_auto',
        `Airbnb groupé ${subsetResas.resas.length} resas${compte !== '__inconnu__' ? ' ['+compte+']' : ''}`)
    }
  }

  // Tentative 3 : fallback tous comptes confondus (si aucun compte renseigné)
  const allHaveAccount = airbnbResas.every(r => r.airbnb_account)
  if (!allHaveAccount) {
    const subsetAll = subsetSumResas(airbnbResas, montant)
    if (subsetAll.found && subsetAll.resas.length > 0) {
      return confirmerMatchResa(mvt, subsetAll.resas, 'matche_auto',
        `Airbnb groupé ${subsetAll.resas.length} resas (comptes non configurés)`)
    }
  }

  return { matched: false, raison: `Airbnb : aucun match pour ${montant}c — vérifier les comptes Airbnb dans Biens` }
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
      try { await supabase.from('payout_reservation').insert({
        payout_id: payout.id,
        reservation_id: match.id,
      }) } catch (_) {}
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
  // Fallback si payout_reservation vide : matching par montant
  for (const payoutId of payoutIds) {
    const { data: liens } = await supabase
      .from('payout_reservation')
      .select('reservation_id')
      .eq('payout_id', payoutId)
    if (liens?.length) {
      reservationIds.push(...liens.map(l => l.reservation_id))
    } else {
      const { data: ph } = await supabase.from('payout_hospitable').select('amount,mois_comptable').eq('id', payoutId).single()
      if (ph?.amount) {
        const { data: cands } = await supabase.from('reservation').select('id,fin_revenue').eq('mois_comptable', ph.mois_comptable || mvt.mois_releve).gt('fin_revenue', 0)
        const found = (cands || []).find(r => Math.abs(r.fin_revenue - ph.amount) <= 5)
        if (found) {
          reservationIds.push(found.id)
          try { await supabase.from('payout_reservation').upsert({ payout_id: payoutId, reservation_id: found.id }, { onConflict: 'payout_id,reservation_id', ignoreDuplicates: true }) } catch (_) {}
        }
      }
    }
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
    // Alimenter reservation_paiement
    for (const resaId of reservationIds) {
      const { data: existRp } = await supabase.from('reservation_paiement')
        .select('id').eq('reservation_id', resaId).eq('mouvement_id', mvt.id).maybeSingle()
      if (!existRp) {
        await supabase.from('reservation_paiement').insert({
          reservation_id: resaId, mouvement_id: mvt.id,
          montant: mvt.credit, date_paiement: mvt.date_operation, type_paiement: 'total',
        }).catch(() => {})
      }
    }
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

/**
 * Subset sum sur réservations (fallback sans payouts)
 */
function subsetSumResas(resas, cible) {
  const TOLERANCE = 2
  // Cherche une combinaison unique dont la somme = cible ±2c
  // D'abord match exact sur 1 resa
  const direct = resas.find(r => Math.abs((r.fin_revenue||0) - cible) <= TOLERANCE)
  if (direct) return { found: true, resas: [direct] }
  // Puis combinaisons de 2-4 resas
  for (let size = 2; size <= 4; size++) {
    const result = findCombination(resas, cible, size, TOLERANCE)
    if (result) return { found: true, resas: result }
  }
  return { found: false, resas: [] }
}

function findCombination(resas, cible, size, tol) {
  function bt(start, current, sum) {
    if (current.length === size) {
      return Math.abs(sum - cible) <= tol ? [...current] : null
    }
    for (let i = start; i < resas.length; i++) {
      current.push(resas[i])
      const r = bt(i + 1, current, sum + (resas[i].fin_revenue||0))
      current.pop()
      if (r) return r
    }
    return null
  }
  return bt(0, [], 0)
}

/**
 * Confirme un match virement ↔ réservations directes (sans payouts)
 */
async function confirmerMatchResa(mvt, resas, statut, note) {
  const resaIds = resas.map(r => r.id)

  await supabase.from('mouvement_bancaire').update({
    statut_matching: statut,
    note_matching: note,
  }).eq('id', mvt.id)

  if (resaIds.length > 0) {
    await supabase.from('reservation')
      .update({ rapprochee: true })
      .in('id', resaIds)

    await supabase.from('ventilation')
      .update({ mouvement_id: mvt.id })
      .in('reservation_id', resaIds)
  }

  // Alimenter reservation_paiement
  for (const resaId of resaIds) {
    const { data: existRp } = await supabase.from('reservation_paiement')
      .select('id').eq('reservation_id', resaId).eq('mouvement_id', mvt.id).maybeSingle()
    if (!existRp) {
      await supabase.from('reservation_paiement').insert({
        reservation_id: resaId, mouvement_id: mvt.id,
        montant: mvt.credit, date_paiement: mvt.date_operation, type_paiement: 'total',
      }).catch(() => {})
    }
  }

  return { matched: true, raison: note, reservationIds: resaIds }
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

/**
 * Valide manuellement un match virement ↔ réservations
 * Version sans payouts — directement sur les réservations
 */
export async function validerMatchManuelResas(mouvementId, resaIds) {
  if (!resaIds || resaIds.length === 0) throw new Error('Aucune réservation sélectionnée')

  const { data: mvt, error: mvtErr } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('id', mouvementId)
    .single()

  if (mvtErr || !mvt) throw new Error('Mouvement introuvable')

  await supabase.from('mouvement_bancaire')
    .update({ statut_matching: 'matche_manuel', note_matching: `Manuel — ${resaIds.length} resa(s)` })
    .eq('id', mouvementId)

  if (resaIds.length > 0) {
    await supabase.from('reservation')
      .update({ rapprochee: true })
      .in('id', resaIds)

    await supabase.from('ventilation')
      .update({ mouvement_id: mouvementId })
      .in('reservation_id', resaIds)

    // Alimenter reservation_paiement — requis pour que annulerRapprochement
    // et resetEtRematcher puissent remettre rapprochee=false correctement
    for (const resaId of resaIds) {
      const { data: existRp } = await supabase.from('reservation_paiement')
        .select('id').eq('reservation_id', resaId).eq('mouvement_id', mouvementId).maybeSingle()
      if (!existRp) {
        await supabase.from('reservation_paiement').insert({
          reservation_id: resaId, mouvement_id: mouvementId,
          montant: mvt.credit, date_paiement: mvt.date_operation, type_paiement: 'total',
        }).catch(() => {})
      }
    }
  }

  return { matched: true, resaIds }
}
// end
