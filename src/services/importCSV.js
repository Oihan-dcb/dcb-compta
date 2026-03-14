import { supabase } from '../lib/supabase'

/**
 * Analyse le CSV Hospitable sans importer — retourne les mois disponibles et le nb de réservations
 */
export async function analyseCSV(file) {
  const text = await file.text()
  const rows = parseCSV(text)
  
  const parMois = {}
  for (const row of rows) {
    const date = row.checkin_date?.substring(0, 7) // YYYY-MM
    if (!date) continue
    if (!parMois[date]) parMois[date] = { mois: date, total: 0, platforms: new Set() }
    parMois[date].total++
    if (row.platform) parMois[date].platforms.add(row.platform)
  }
  
  // Convertir les Sets en arrays pour sérialisation
  const result = Object.values(parMois)
    .sort((a, b) => b.mois.localeCompare(a.mois))
    .map(m => ({ ...m, platforms: [...m.platforms] }))
  
  return { rows, parMois: result, total: rows.length }
}

/**
 * Importe les réservations du CSV pour les mois sélectionnés
 */
export async function importHospitableCSV(rows, moisFiltres = null) {
  // Filtrer par mois si spécifié
  const filtered = moisFiltres
    ? rows.filter(r => moisFiltres.includes(r.checkin_date?.substring(0, 7)))
    : rows

  const log = { total: filtered.length, updated: 0, created: 0, errors: 0, skipped: 0 }

  const BATCH = 10
  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH)
    await Promise.all(batch.map(row => processRow(row, log)))
  }

  return log
}

async function processRow(row, log) {
  try {
    const code = row.code?.trim()
    if (!code) { log.skipped++; return }

    const guestName = [row.guest_first_name, row.guest_last_name].filter(Boolean).join(' ') || null
    const finalStatus = mapStatus(row.status)
    const cur = row.currency || 'EUR'

    // Montants en centimes (CSV en euros)
    const toC = v => v ? Math.round(parseFloat(v) * 100) : null
    
    const revenueCents = toC(row.payout || row.revenue)
    const accommodationCents = toC(row.base_amount)
    const moisComptable = row.checkin_date?.substring(0, 7) || null

    // Chercher la réservation existante par code
    const { data: existing } = await supabase
      .from('reservation')
      .select('id, hospitable_id')
      .eq('code', code)
      .maybeSingle()

    if (!existing) {
      // Réservation non encore en base — chercher le bien par property_id Hospitable
      const { data: bien } = await supabase
        .from('bien')
        .select('id')
        .eq('hospitable_id', row.property_id)
        .maybeSingle()

      if (!bien) { log.skipped++; return }

      // Créer la réservation minimale
      const { data: newResa, error: insErr } = await supabase
        .from('reservation')
        .insert({
          bien_id: bien.id,
          code,
          platform: row.platform,
          arrival_date: row.checkin_date,
          departure_date: row.checkout_date,
          nights: row.nights ? parseInt(row.nights) : null,
          guest_name: guestName,
          guest_count: row.guest_count ? parseInt(row.guest_count) : null,
          final_status: finalStatus,
          fin_revenue: revenueCents,
          fin_accommodation: accommodationCents,
          mois_comptable: moisComptable,
        })
        .select('id').single()

      if (insErr || !newResa) { log.errors++; return }
      await syncFees(newResa.id, row, cur)
      log.created++
      return
    }

    // Mettre à jour la réservation existante
    await supabase.from('reservation').update({
      guest_name: guestName,
      final_status: finalStatus,
      fin_revenue: revenueCents,
      fin_accommodation: accommodationCents,
    }).eq('id', existing.id)

    await syncFees(existing.id, row, cur)
    log.updated++

  } catch (err) {
    console.error('importCSV row error:', err)
    log.errors++
  }
}

async function syncFees(resaId, row, cur) {
  const fees = []
  const toC = v => Math.round(parseFloat(v || '0') * 100)

  const addFee = (label, val, feeType, category) => {
    const amount = toC(val)
    if (amount !== 0) fees.push({
      reservation_id: resaId, label, amount,
      fee_type: feeType, category, currency: cur,
      formatted: `€${Math.abs(parseFloat(val || 0)).toFixed(2)}`
    })
  }

  addFee('Cleaning fee', row.cleaning_fee, 'guest_fee', 'Guest fees')
  addFee('Linen fee', row.linen_fee, 'guest_fee', 'Guest fees')
  addFee('Management fee', row.management_fee, 'guest_fee', 'Guest fees')
  addFee('Community fee', row.community_fee, 'guest_fee', 'Guest fees')
  addFee('Resort fee', row.resort_fee, 'guest_fee', 'Guest fees')
  addFee('Pet fee', row.pet_fee, 'guest_fee', 'Guest fees')
  addFee('Extra guest fee', row.extra_guest_fee, 'guest_fee', 'Guest fees')
  addFee('Other fee', row.other_fee, 'guest_fee', 'Guest fees')

  // Host service fee = négatif
  const hsf = parseFloat(row.host_service_fee || '0')
  if (hsf !== 0) fees.push({
    reservation_id: resaId, label: 'Host Service Fee',
    amount: -Math.round(Math.abs(hsf) * 100),
    fee_type: 'host_fee', category: 'Service fees', currency: cur,
    formatted: `-€${Math.abs(hsf).toFixed(2)}`
  })

  addFee('Pass-through taxes', row.pass_through_taxes, 'tax', 'Host Tax')
  addFee('Remitted taxes', row.remitted_taxes, 'tax', 'Host Tax')

  if (fees.length > 0) {
    await supabase.from('reservation_fee').delete().eq('reservation_id', resaId)
    await supabase.from('reservation_fee').insert(fees)
  }
}

function mapStatus(status) {
  const s = (status || '').toLowerCase()
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s === 'request') return 'request'
  return 'accepted'
}

export function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h.trim()] = values[i]?.trim() || '' })
    return row
  }).filter(r => r.code)
}

function parseCSVLine(line) {
  const result = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (inQuotes && line[i+1] === '"') { current += '"'; i++ } else inQuotes = !inQuotes }
    else if (c === ',' && !inQuotes) { result.push(current); current = '' }
    else current += c
  }
  result.push(current)
  return result
}

/**
 * Détecte et fusionne les doublons dans la table reservation
 * Un doublon = même code mais IDs différents
 */
export async function fusionnerDoublons() {
  // 1. Trouver tous les codes en double
  const { data: doublons } = await supabase.rpc('find_duplicate_reservations')
    .catch(() => ({ data: null }))

  // Fallback si la fonction RPC n'existe pas encore
  const { data: allResas } = await supabase
    .from('reservation')
    .select('id, code, hospitable_id, guest_name, fin_revenue, mois_comptable, bien_id')
    .order('code')

  if (!allResas) return { fusions: 0, errors: 0 }

  // Grouper par code
  const parCode = {}
  for (const r of allResas) {
    if (!r.code) continue
    if (!parCode[r.code]) parCode[r.code] = []
    parCode[r.code].push(r)
  }

  const codes = Object.entries(parCode).filter(([, v]) => v.length > 1)
  const log = { doublons: codes.length, fusions: 0, errors: 0 }

  for (const [code, resas] of codes) {
    try {
      // Stratégie : garder la resa avec hospitable_id (sync API) comme master
      // Merger les données de la resa CSV (guest_name, fees) dedans
      const master = resas.find(r => r.hospitable_id) || resas[0]
      const slaves = resas.filter(r => r.id !== master.id)

      for (const slave of slaves) {
        // Copier les données manquantes du slave vers le master
        const updates = {}
        if (!master.guest_name && slave.guest_name) updates.guest_name = slave.guest_name
        if (!master.fin_revenue && slave.fin_revenue) updates.fin_revenue = slave.fin_revenue

        if (Object.keys(updates).length > 0) {
          await supabase.from('reservation').update(updates).eq('id', master.id)
        }

        // Réassigner les fees du slave vers le master (si master n'en a pas)
        const { count: masterFees } = await supabase
          .from('reservation_fee')
          .select('id', { count: 'exact', head: true })
          .eq('reservation_id', master.id)

        if (masterFees === 0) {
          await supabase.from('reservation_fee')
            .update({ reservation_id: master.id })
            .eq('reservation_id', slave.id)
        }

        // Réassigner les ventilations
        await supabase.from('ventilation')
          .update({ reservation_id: master.id })
          .eq('reservation_id', slave.id)

        // Supprimer le doublon
        await supabase.from('reservation_fee').delete().eq('reservation_id', slave.id)
        await supabase.from('reservation').delete().eq('id', slave.id)
      }

      log.fusions++
    } catch (err) {
      console.error('Fusion error for code', code, err)
      log.errors++
    }
  }

  return log
}
