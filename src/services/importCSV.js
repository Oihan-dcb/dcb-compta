import { supabase } from '../lib/supabase'

/**
 * Parse et importe le CSV d'export Hospitable
 * Met à jour : guest_name, fees (ménage, taxes, etc.)
 */
export async function importHospitableCSV(file) {
  const text = await file.text()
  const rows = parseCSV(text)

  const log = { total: rows.length, updated: 0, errors: 0 }

  // Traitement par batch de 10
  const BATCH = 10
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await Promise.all(batch.map(row => processRow(row, log)))
  }

  return log
}

async function processRow(row, log) {
  try {
    const code = row.code?.trim()
    if (!code) return

    // 1. Mettre à jour guest_name + final_status sur la réservation
    const guestName = [row.guest_first_name, row.guest_last_name].filter(Boolean).join(' ') || null
    const finalStatus = mapStatus(row.status)

    const { data: resa, error: resaErr } = await supabase
      .from('reservation')
      .update({
        guest_name: guestName,
        final_status: finalStatus,
        // Montants en centimes depuis le CSV (valeurs en euros avec décimales)
        fin_revenue: row.payout ? Math.round(parseFloat(row.payout) * 100) : null,
        fin_accommodation: row.base_amount ? Math.round(parseFloat(row.base_amount) * 100) : null,
      })
      .eq('code', code)
      .select('id')
      .single()

    if (resaErr || !resa) { log.errors++; return }

    // 2. Rebuilder les fees depuis le CSV (source de vérité)
    const fees = []
    const cur = row.currency || 'EUR'

    const addFee = (label, amountStr, feeType, category) => {
      const amount = Math.round(parseFloat(amountStr || '0') * 100)
      if (amount !== 0) fees.push({ reservation_id: resa.id, label, amount, fee_type: feeType, category, currency: cur, formatted: `€${parseFloat(amountStr || '0').toFixed(2)}` })
    }

    addFee('Cleaning fee', row.cleaning_fee, 'guest_fee', 'Guest fees')
    addFee('Linen fee', row.linen_fee, 'guest_fee', 'Guest fees')
    addFee('Management fee', row.management_fee, 'guest_fee', 'Guest fees')
    addFee('Community fee', row.community_fee, 'guest_fee', 'Guest fees')
    addFee('Resort fee', row.resort_fee, 'guest_fee', 'Guest fees')
    addFee('Pet fee', row.pet_fee, 'guest_fee', 'Guest fees')
    addFee('Extra guest fee', row.extra_guest_fee, 'guest_fee', 'Guest fees')
    addFee('Other fee', row.other_fee, 'guest_fee', 'Guest fees')
    // Host service fee : valeur CSV positive → on la rend négative (frais de la plateforme)
    const hsfAmount = parseFloat(row.host_service_fee || '0')
    if (hsfAmount !== 0) fees.push({ reservation_id: resa.id, label: 'Host Service Fee', amount: -Math.round(Math.abs(hsfAmount) * 100), fee_type: 'host_fee', category: 'Service fees', currency: cur, formatted: `-€${Math.abs(hsfAmount).toFixed(2)}` })
    addFee('Pass-through taxes', row.pass_through_taxes, 'tax', 'Host Tax')
    addFee('Remitted taxes', row.remitted_taxes, 'tax', 'Host Tax')

    // Supprimer les anciennes fees et insérer les nouvelles
    await supabase.from('reservation_fee').delete().eq('reservation_id', resa.id)
    if (fees.length > 0) {
      await supabase.from('reservation_fee').insert(fees)
    }

    log.updated++
  } catch (err) {
    console.error('importCSV row error:', err)
    log.errors++
  }
}

function mapStatus(status) {
  if (!status) return 'accepted'
  const s = status.toLowerCase()
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s === 'request') return 'request'
  return 'accepted'
}

/**
 * Parse CSV avec gestion des guillemets et virgules dans les valeurs
 */
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = parseCSVLine(lines[0])
  const rows = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.length < 2) continue
    const row = {}
    headers.forEach((h, idx) => { row[h.trim()] = values[idx]?.trim() || '' })
    rows.push(row)
  }

  return rows
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}
