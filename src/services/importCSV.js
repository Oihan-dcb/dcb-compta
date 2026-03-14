import { supabase } from '../lib/supabase'

/**
 * Analyse le CSV Hospitable sans importer — retourne les mois disponibles
 */
export async function analyseCSV(file) {
  const text = await file.text()
  const rows = parseCSV(text)

  const parMois = {}
  for (const row of rows) {
    const date = row.checkin_date?.substring(0, 7)
    if (!date) continue
    if (!parMois[date]) parMois[date] = { mois: date, total: 0, platforms: new Set() }
    parMois[date].total++
    if (row.platform) parMois[date].platforms.add(row.platform)
  }

  const result = Object.values(parMois)
    .sort((a, b) => b.mois.localeCompare(a.mois))
    .map(m => ({ ...m, platforms: [...m.platforms] }))

  return { rows, parMois: result, total: rows.length }
}

/**
 * Import bulk — 1 upsert par batch de 500, ~5 secondes pour 6000 resas
 */
export async function importHospitableCSV(rows, moisFiltres = null, onProgress = null) {
  const filtered = moisFiltres
    ? rows.filter(r => moisFiltres.includes(r.checkin_date?.substring(0, 7)))
    : rows

  const log = { total: filtered.length, updated: 0, created: 0, errors: 0, skipped: 0 }

  // ── Étape 1 : charger tous les biens (map hospitable_id → bien_id) ──
  const { data: biens } = await supabase.from('bien').select('id, hospitable_id')
  const bienMap = {}
  for (const b of biens || []) bienMap[b.hospitable_id] = b.id

  // ── Étape 2 : charger toutes les réservations existantes (map code → id) ──
  const { data: existing } = await supabase
    .from('reservation')
    .select('id, code')
  const resaMap = {}
  for (const r of existing || []) resaMap[r.code] = r.id

  onProgress?.({ step: 'prepare', pct: 10 })

  // ── Étape 3 : préparer toutes les lignes reservation ──
  const toUpsert = []
  const toInsert = []

  for (const row of filtered) {
    const code = row.code?.trim()
    if (!code) { log.skipped++; continue }

    const bienId = bienMap[row.property_id]
    if (!bienId && !resaMap[code]) { log.skipped++; continue }

    const guestName = [row.guest_first_name, row.guest_last_name].filter(Boolean).join(' ') || null
    const toC = v => v && parseFloat(v) !== 0 ? Math.round(parseFloat(v) * 100) : null

    const base = {
      code,
      guest_name: guestName,
      final_status: mapStatus(row.status),
      fin_revenue: toC(row.payout || row.revenue),
      fin_accommodation: toC(row.base_amount),
    }

    if (resaMap[code]) {
      // Existe → update seulement les champs CSV
      toUpsert.push({ id: resaMap[code], ...base })
    } else {
      // Nouvelle → insert complet
      toInsert.push({
        ...base,
        bien_id: bienId,
        platform: row.platform,
        arrival_date: row.checkin_date || null,
        departure_date: row.checkout_date || null,
        nights: row.nights ? parseInt(row.nights) : null,
        guest_count: row.guest_count ? parseInt(row.guest_count) : null,
        mois_comptable: row.checkin_date?.substring(0, 7) || null,
      })
    }
  }

  onProgress?.({ step: 'upsert', pct: 20 })

  // ── Étape 4 : upsert en bulk (batch 500) ──
  const BULK = 500
  for (let i = 0; i < toUpsert.length; i += BULK) {
    const batch = toUpsert.slice(i, i + BULK)
    const { error } = await supabase.from('reservation').upsert(batch, { onConflict: 'id' })
    if (error) { log.errors += batch.length; console.error('upsert error:', error) }
    else log.updated += batch.length
    onProgress?.({ step: 'upsert', pct: 20 + Math.round((i / toUpsert.length) * 30) })
  }

  for (let i = 0; i < toInsert.length; i += BULK) {
    const batch = toInsert.slice(i, i + BULK)
    const { data: inserted, error } = await supabase.from('reservation').insert(batch).select('id, code')
    if (error) { log.errors += batch.length; console.error('insert error:', error) }
    else {
      log.created += batch.length
      // Mettre à jour resaMap avec les nouveaux IDs
      for (const r of inserted || []) resaMap[r.code] = r.id
    }
    onProgress?.({ step: 'insert', pct: 50 + Math.round((i / Math.max(toInsert.length, 1)) * 10) })
  }

  onProgress?.({ step: 'fees', pct: 60 })

  // ── Étape 5 : préparer toutes les fees en bulk ──
  const allFees = []
  const resaIdsToClean = []

  for (const row of filtered) {
    const code = row.code?.trim()
    if (!code) continue
    const resaId = resaMap[code]
    if (!resaId) continue

    const cur = row.currency || 'EUR'
    const toC = v => Math.round(parseFloat(v || '0') * 100)
    const fees = buildFees(resaId, row, cur, toC)

    if (fees.length > 0) {
      allFees.push(...fees)
      resaIdsToClean.push(resaId)
    }
  }

  // ── Étape 6 : supprimer les anciennes fees en bulk par batch ──
  const CLEAN_BATCH = 200
  for (let i = 0; i < resaIdsToClean.length; i += CLEAN_BATCH) {
    const ids = resaIdsToClean.slice(i, i + CLEAN_BATCH)
    await supabase.from('reservation_fee').delete().in('reservation_id', ids)
    onProgress?.({ step: 'clean_fees', pct: 60 + Math.round((i / resaIdsToClean.length) * 15) })
  }

  // ── Étape 7 : insérer les nouvelles fees en bulk ──
  for (let i = 0; i < allFees.length; i += BULK) {
    const batch = allFees.slice(i, i + BULK)
    const { error } = await supabase.from('reservation_fee').insert(batch)
    if (error) console.error('fees insert error:', error)
    onProgress?.({ step: 'insert_fees', pct: 75 + Math.round((i / Math.max(allFees.length, 1)) * 15) })
  }

  onProgress?.({ step: 'dedup', pct: 90 })

  // ── Étape 8 : fusion doublons ──
  const fusion = await fusionnerDoublons(resaMap)
  log.fusion = fusion

  onProgress?.({ step: 'done', pct: 100 })
  return log
}

function buildFees(resaId, row, cur, toC) {
  const fees = []
  const add = (label, val, feeType, category) => {
    const amount = toC(val)
    if (amount !== 0) fees.push({ reservation_id: resaId, label, amount, fee_type: feeType, category, currency: cur })
  }
  add('Cleaning fee', row.cleaning_fee, 'guest_fee', 'Guest fees')
  add('Linen fee', row.linen_fee, 'guest_fee', 'Guest fees')
  add('Management fee', row.management_fee, 'guest_fee', 'Guest fees')
  add('Community fee', row.community_fee, 'guest_fee', 'Guest fees')
  add('Resort fee', row.resort_fee, 'guest_fee', 'Guest fees')
  add('Pet fee', row.pet_fee, 'guest_fee', 'Guest fees')
  add('Extra guest fee', row.extra_guest_fee, 'guest_fee', 'Guest fees')
  add('Other fee', row.other_fee, 'guest_fee', 'Guest fees')
  const hsf = parseFloat(row.host_service_fee || '0')
  if (hsf !== 0) fees.push({ reservation_id: resaId, label: 'Host Service Fee', amount: -Math.round(Math.abs(hsf) * 100), fee_type: 'host_fee', category: 'Service fees', currency: cur })
  add('Pass-through taxes', row.pass_through_taxes, 'tax', 'Host Tax')
  add('Remitted taxes', row.remitted_taxes, 'tax', 'Host Tax')
  return fees
}

export async function fusionnerDoublons(resaMapHint = null) {
  const { data: allResas } = await supabase
    .from('reservation')
    .select('id, code, hospitable_id, guest_name, fin_revenue')
    .order('code')

  if (!allResas) return { doublons: 0, fusions: 0, errors: 0 }

  const parCode = {}
  for (const r of allResas) {
    if (!r.code) continue
    if (!parCode[r.code]) parCode[r.code] = []
    parCode[r.code].push(r)
  }

  const doubles = Object.entries(parCode).filter(([, v]) => v.length > 1)
  const log = { doublons: doubles.length, fusions: 0, errors: 0 }

  for (const [, resas] of doubles) {
    try {
      const master = resas.find(r => r.hospitable_id) || resas[0]
      const slaves = resas.filter(r => r.id !== master.id)

      const updates = {}
      for (const slave of slaves) {
        if (!master.guest_name && slave.guest_name) updates.guest_name = slave.guest_name
        if (!master.fin_revenue && slave.fin_revenue) updates.fin_revenue = slave.fin_revenue
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('reservation').update(updates).eq('id', master.id)
      }

      for (const slave of slaves) {
        // Migrer fees et ventilations vers le master
        await supabase.from('reservation_fee').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        await supabase.from('ventilation').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        await supabase.from('reservation').delete().eq('id', slave.id)
      }
      log.fusions++
    } catch (err) {
      log.errors++
    }
  }
  return log
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
