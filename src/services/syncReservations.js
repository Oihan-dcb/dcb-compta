/**
 * Service de synchronisation des réservations Hospitable → Supabase
 * Récupère les réservations avec financials et les ventile automatiquement
 */

import { supabase } from '../lib/supabase'
import { fetchReservations } from '../lib/hospitable'
import { format, parseISO } from 'date-fns'

/**
 * Synchronise les réservations d'un mois donné pour tous les biens actifs
 *
 * @param {string} mois - Format YYYY-MM (ex: "2026-02")
 * @returns {Promise<{created, updated, errors, total}>}
 */
export async function syncReservations(mois) {
  const log = { created: 0, updated: 0, errors: 0, total: 0 }

  // Dates du mois
  const [year, month] = mois.split('-').map(Number)
  const startDate = `${mois}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${mois}-${String(lastDay).padStart(2, '0')}`

  try {
    // 1. Récupérer tous les biens actifs avec leurs IDs Hospitable
    const { data: biens, error: biensError } = await supabase
      .from('bien')
      .select('id, hospitable_id, hospitable_name, proprietaire_id, provision_ae_ref, forfait_dcb_ref, has_ae')
      .eq('listed', true)

    if (biensError) throw biensError
    if (!biens || biens.length === 0) throw new Error('Aucun bien actif trouvé')

    const bienMap = new Map(biens.map(b => [b.hospitable_id, b]))
    const hospIds = biens.map(b => b.hospitable_id)

    // 2. Récupérer les réservations en parallèle (batch de 10) — l'API v2 ne retourne pas property_id
    const BATCH = 10
    let allReservations = []
    for (let i = 0; i < hospIds.length; i += BATCH) {
      const batch = hospIds.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(async hospId => {
          const resas = await fetchReservations([hospId], { startDate, endDate })
          resas.forEach(r => { r.property_id = hospId })
          return resas
        })
      )
      allReservations = allReservations.concat(results.flat())
    }

    log.total = allReservations.length

    // 3. Récupérer les réservations existantes dans Supabase pour ce mois
    const { data: existing } = await supabase
      .from('reservation')
      .select('id, hospitable_id')
      .eq('mois_comptable', mois)

    const existingMap = new Map((existing || []).map(r => [r.hospitable_id, r]))

    // 4. Traiter chaque réservation
    for (const resa of allReservations) {
      try {
        const bien = bienMap.get(resa.property_id || findBienByResa(resa, biens))
        if (!bien) continue

        const parsed = parseReservation(resa, bien, mois)

        // Upsert réservation
        const { data: upserted, error } = await supabase
          .from('reservation')
          .upsert(parsed, { onConflict: 'hospitable_id' })
          .select('id')
          .single()

        if (error) throw error

        // Upsert les fees détaillés
        if (resa.financials?.host) {
          await syncReservationFees(upserted.id, resa.financials.host)
        }

        if (existingMap.has(resa.id)) {
          log.updated++
        } else {
          log.created++
        }
      } catch (err) {
        console.error(`Erreur résa ${resa.code}:`, err)
        log.errors++
      }
    }

    await supabase.from('import_log').insert({
      type: 'hospitable_reservations',
      mois_concerne: mois,
      statut: log.errors > 0 ? 'partial' : 'success',
      nb_lignes_traitees: log.total,
      nb_lignes_creees: log.created,
      nb_lignes_mises_a_jour: log.updated,
      nb_erreurs: log.errors,
      message: `Sync réservations ${mois} — ${log.created} créées, ${log.updated} mises à jour, ${log.errors} erreurs`,
    })

    return log
  } catch (err) {
    console.error('Erreur sync réservations:', err)
    try { await supabase.from('import_log').insert({
      type: 'hospitable_reservations',
      mois_concerne: mois,
      statut: 'error',
      nb_erreurs: 1,
      message: err.message,
    }) } catch (_) {}
    throw err
  }
}

/**
 * Parse une réservation Hospitable en format Supabase
 */
function parseReservation(resa, bien, mois) {
  const fin = resa.financials?.host || {}
  const guest = resa.guests?.[0] || {}

  // Extraire le host service fee (commission plateforme)
  const hostServiceFee = (fin.host_fees || []).find(f =>
    f.label?.toLowerCase().includes('host service') ||
    f.label?.toLowerCase().includes('service fee')
  )

  // Total taxes pass-through
  const taxesTotal = (fin.taxes || []).reduce((s, t) => s + (t.amount || 0), 0)

  // Mois comptable = mois du check-in (config DCB)
  const arrivalDate = resa.arrival_date ? parseISO(resa.arrival_date) : null
  const moisComptable = arrivalDate ? format(arrivalDate, 'yyyy-MM') : mois

  return {
    hospitable_id: resa.id,
    bien_id: bien.id,
    code: resa.code,
    platform: resa.platform,
    platform_id: resa.platform_id,
    arrival_date: resa.arrival_date?.substring(0, 10),
    departure_date: resa.departure_date?.substring(0, 10),
    nights: resa.nights,
    checkin_time: resa.check_in,
    checkout_time: resa.check_out,
    guest_name: guest.name || resa.guests?.map?.(g => g.name).join(', '),
    guest_count: resa.guests?.reduce?.((s, g) => s + (g.count || 1), 0) || null,
    stay_type: resa.stay_type || 'guest',
    owner_stay: resa.owner_stay || false,
    reservation_status: resa.reservation_status,
    final_status: resa.reservation_status?.current?.category || resa.status || 'accepted',
    // Financials en centimes
    fin_accommodation: fin.accommodation?.amount ?? null,
    fin_revenue: fin.revenue?.amount ?? null,
    fin_host_service_fee: hostServiceFee?.amount ?? null,
    fin_taxes_total: taxesTotal || null,
    fin_currency: fin.currency || 'EUR',
    mois_comptable: moisComptable,
    hospitable_raw: resa,
  }
}

/**
 * Sync les fees détaillés d'une réservation
 * Supprime et recrée pour garantir la cohérence
 */
async function syncReservationFees(reservationId, hostFinancials) {
  // Supprimer les fees existants
  await supabase.from('reservation_fee').delete().eq('reservation_id', reservationId)

  const fees = []

  // Guest fees (Cleaning Fee, Community Fee, Management Fee)
  for (const fee of (hostFinancials.guest_fees || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'guest_fee',
      label: fee.label,
      category: fee.category,
      amount: fee.amount,
      formatted: fee.formatted,
    })
  }

  // Host fees (Host Service Fee = commission plateforme)
  for (const fee of (hostFinancials.host_fees || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'host_fee',
      label: fee.label,
      category: fee.category,
      amount: fee.amount,
      formatted: fee.formatted,
    })
  }

  // Taxes (taxe de séjour, additionnelles...)
  for (const tax of (hostFinancials.taxes || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'tax',
      label: tax.label,
      category: tax.category,
      amount: tax.amount,
      formatted: tax.formatted,
    })
  }

  // Accommodation breakdown (prix par nuit)
  for (const night of (hostFinancials.accommodation_breakdown || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'accommodation_night',
      label: night.label,
      category: night.category,
      amount: night.amount,
      formatted: night.formatted,
      nuit_date: night.label, // label = date YYYY-MM-DD
    })
  }

  if (fees.length > 0) {
    const { error } = await supabase.from('reservation_fee').insert(fees)
    if (error) console.error('Erreur insert fees:', error)
  }
}

/**
 * Fallback pour trouver le bien d'une réservation quand property_id est absent
 */
function findBienByResa(resa, biens) {
  // Essayer via code de réservation ou autres champs
  return null
}

/**
 * Récupère les réservations d'un mois depuis Supabase (avec fees et bien)
 */
export async function getReservationsMois(mois) {
  const { data, error } = await supabase
    .from('reservation')
    .select(`
      id, code, platform, arrival_date, departure_date, nights, guest_name,
      fin_revenue, fin_accommodation, owner_stay, ventilation_calculee, rapprochee,
      final_status, mois_comptable,
      bien (
        id, hospitable_name, code, proprietaire_id,
        provision_ae_ref, forfait_dcb_ref, has_ae,
        taux_commission_override,
        proprietaire (id, nom, prenom, taux_commission)
      ),
      reservation_fee (*),
      ventilation (code, taux_calcule, montant_ht, montant_tva, montant_ttc, libelle)
    `)
    .eq('mois_comptable', mois)
    .order('arrival_date')

  if (error) throw error
  return data || []
}
