/**
 * Service de rapprochement bancaire DCB — Sprint B
 *
 * Chaîne de matching Airbnb/Booking :
 *   mouvement_bancaire → payout_hospitable (montant exact) → payout_reservation → reservation → ventilation(VIR)
 *
 * Matching SEPA/Direct : manuel uniquement
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
    const mouvements = await getMouvementsMois(mois)
    const libres = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit || 0) > 0)

    // ── AIRBNB + BOOKING via payout_hospitable ─────────────────
    // Logique : mouvement.credit = payout.amount (centimes)
    // → via payout_reservation → reservation → VIR
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)

      for (const mouv of mouvCanal) {
        try {
          // 1. Chercher le payout dont le montant = crédit du mouvement (±2 centimes)
          const { data: payouts } = await supabase
            .from('payout_hospitable')
            .select(`
              id, amount, date_payout,
              payout_reservation (
                reservation_id,
                reservation (id, code, mois_comptable)
              )
            `)
            .eq('platform', canal)
            .is('mouvement_id', null)
            .gte('amount', mouv.credit - 2)
            .lte('amount', mouv.credit + 2)

          if (!payouts?.length) { log.skipped++; continue }

          const payout = payouts[0]
          const resaIds = payout.payout_reservation
            ?.map(pr => pr.reservation_id)
            .filter(Boolean) || []

          if (!resaIds.length) { log.skipped++; continue }

          // 2. Trouver les VIR correspondants à ces réservations
          const { data: virs } = await supabase
            .from('ventilation')
            .select('id, reservation_id')
            .eq('code', 'VIR')
            .is('mouvement_id', null)
            .in('reservation_id', resaIds)

          if (!virs?.length) { log.skipped++; continue }

          // 3. Lier : mouvement ↔ VIR + marquer payout comme lié
          await _lier(mouv.id, virs.map(v => v.id))
          await supabase
            .from('payout_hospitable')
            .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
            .eq('id', payout.id)

          log.matched++
          log.details.push({
            type: canal,
            montant: mouv.credit / 100,
            date: mouv.date_operation,
            nb_resas: resaIds.length,
            resas: payout.payout_reservation?.map(pr => pr.reservation?.code).filter(Boolean)
          })

        } catch (err) {
          log.errors++
          console.error('Erreur matching', canal, mouv.id, err.message)
        }
      }
    }

    // ── STRIPE — 1 virement mensuel = somme VIR stripe ────────
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    if (mouvStripe.length >= 1) {
      const { data: virStripe } = await supabase
        .from('ventilation')
        .select('id, montant_ttc, reservation(platform)')
        .eq('code', 'VIR')
        .is('mouvement_id', null)

      const stripeVirs = (virStripe || []).filter(v => v.reservation?.platform === 'stripe')

      for (const mouv of mouvStripe) {
        const totalStripe = stripeVirs.reduce((s, v) => s + v.montant_ttc, 0)
        if (stripeVirs.length > 0 && Math.abs(mouv.credit - totalStripe) <= 100) {
          await _lier(mouv.id, stripeVirs.map(v => v.id))
          log.matched++
          log.details.push({ type: 'stripe_mensuel', montant: mouv.credit / 100, nb: stripeVirs.length })
          break
        }
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
  // Délier le payout si présent
  await supabase.from('payout_hospitable').update({ mouvement_id: null, statut_matching: 'en_attente' }).eq('mouvement_id', mouvementId)
  await supabase.from('mouvement_bancaire').update({ statut_matching: 'en_attente' }).eq('id', mouvementId)
}

// ── HELPER PRIVÉ ───────────────────────────────────────────────

async function _lier(mouvementId, virIds, statut = 'rapproche') {
  await supabase.from('ventilation').update({ mouvement_id: mouvementId }).in('id', virIds)
  await supabase.from('mouvement_bancaire').update({ statut_matching: statut }).eq('id', mouvementId)
  const { data: v } = await supabase.from('ventilation').select('reservation_id').in('id', virIds)
  if (v?.length) {
    const ids = [...new Set(v.map(x => x.reservation_id).filter(Boolean))]
    if (ids.length) await supabase.from('reservation').update({ rapprochee: true }).in('id', ids)
  }
}
