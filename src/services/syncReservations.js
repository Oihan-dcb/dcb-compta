/**
 * Service de synchronisation des réservations Hospitable → Supabase
 * Récupère les réservations avec financials et les ventile automatiquement
 */

import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
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
      .select('id, hospitable_id, hospitable_name, proprietaire_id, provision_ae_ref, forfait_dcb_ref, has_ae, agence')
      .eq('listed', true)
    .eq('agence', AGENCE)

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
          .upsert(
            // Ne pas écraser guest_name si null (vient toujours du CSV Hospitable)
            parsed.guest_name ? parsed : { ...parsed, guest_name: undefined },
            { onConflict: 'hospitable_id' }
          )
          .select('id')
          .single()

        if (error) throw error

        // Upsert les fees détaillés
        if (resa.financials?.host) {
          await syncReservationFees(upserted.id, resa.financials.host)
        }

        // Airbnb : payout = fin_revenue (financials.host.revenue.amount)
        // date_payout = arrival_date (Airbnb génère le payout au check-in)
        // Ne pas créer de payout synthétique pour les biens hors-séquestre (gestion_loyer=false)
        // car Airbnb vire directement au propriétaire — pas de virement côté DCB
        if (resa.platform === 'airbnb' && parsed.fin_revenue && parsed.arrival_date && bien.gestion_loyer !== false) {
          await supabase.from('payout_hospitable').upsert({
            hospitable_id: resa.id + '_airbnb_payout',
            platform: 'airbnb',
            amount: parsed.fin_revenue,
            date_payout: parsed.arrival_date,
            mois_comptable: parsed.mois_comptable,
            statut_matching: 'en_attente',
          }, { onConflict: 'hospitable_id', ignoreDuplicates: false })
          // Créer aussi payout_reservation si pas déjà présent
          const { data: ph } = await supabase.from('payout_hospitable')
            .select('id').eq('hospitable_id', resa.id + '_airbnb_payout').single()
          if (ph?.id) {
            await supabase.from('payout_reservation').upsert({
              payout_id: ph.id,
              reservation_id: upserted.id,
            }, { onConflict: 'payout_id', ignoreDuplicates: true })
          }
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
  const guest = resa.guest || {} // API v2 : disponible avec include=guest

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
    platform: (resa.platform === 'booking.com' ? 'booking' : resa.platform),
    platform_id: resa.platform_id,
    arrival_date: resa.arrival_date?.substring(0, 10),
    departure_date: resa.departure_date?.substring(0, 10),
    nights: resa.nights,
    checkin_time: resa.check_in,
    checkout_time: resa.check_out,
    guest_name: [resa.guest?.first_name, resa.guest?.last_name].filter(Boolean).join(' ') || resa.guest_name || null,
    guest_count: resa.guest_count || resa.guests?.total || null,
    stay_type: resa.stay_type || 'guest',
    owner_stay: resa.owner_stay || false,
    reservation_status: resa.reservation_status,
    final_status: resa.reservation_status?.current?.category || resa.status || 'accepted',
    // Financials en centimes
    fin_accommodation: fin.accommodation?.amount ?? null,
    // Airbnb renvoie le revenu théorique même pour les resas expirées/refusées — on force 0
    fin_revenue: ['not_accepted', 'not accepted', 'declined', 'expired'].includes(
      resa.reservation_status?.current?.category || resa.status
    ) ? 0 : (fin.revenue?.amount ?? null),
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
 * Stratégie en cascade : platform_id → nom annonce → correspondance partielle nom
 */
function findBienByResa(resa, biens) {
  if (!resa || !biens || biens.length === 0) return null

  // 1. Match par platform_id (ex: ID Airbnb de l'annonce)
  if (resa.platform_id) {
    const byPlatform = biens.find(b =>
      b.hospitable_id && b.hospitable_id.toString() === resa.platform_id.toString()
    )
    if (byPlatform) return byPlatform.id
  }

  // 2. Match par nom d'annonce exact (hospitable_name)
  if (resa.property_name || resa.listing_name) {
    const name = (resa.property_name || resa.listing_name || '').toLowerCase().trim()
    const byName = biens.find(b =>
      b.hospitable_name && b.hospitable_name.toLowerCase().trim() === name
    )
    if (byName) return byName.id
  }

  // 3. Match partiel sur le nom (ex: "416 Harea" ↔ "416")
  if (resa.property_name || resa.listing_name) {
    const name = (resa.property_name || resa.listing_name || '').toLowerCase()
    const byPartial = biens.find(b =>
      b.hospitable_name && (
        name.includes(b.hospitable_name.toLowerCase().substring(0, 6)) ||
        b.hospitable_name.toLowerCase().includes(name.substring(0, 6))
      )
    )
    if (byPartial) return byPartial.id
  }

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
        id, hospitable_name, code, proprietaire_id, agence,
        provision_ae_ref, forfait_dcb_ref, has_ae,
        taux_commission_override,
        proprietaire (id, nom, prenom, taux_commission)
      ),
      reservation_fee (*),
      ventilation (code, taux_calcule, montant_ht, montant_tva, montant_ttc, libelle),
      hospitable_raw
    `)
    .eq('mois_comptable', mois)
    .order('arrival_date')

  if (error) throw error
  return (data || []).filter(r => (r.bien?.agence || AGENCE) === AGENCE)
}
