import { supabase } from '../lib/supabase'

/**
 * Analyse le CSV Hospitable sans importer Ã¢ÂÂ retourne les mois disponibles
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
 * Import bulk Ã¢ÂÂ 1 upsert par batch de 500, ~5 secondes pour 6000 resas
 */
export async function importHospitableCSV(rows, moisFiltres = null, onProgress = null) {
  const filtered = moisFiltres
    ? rows.filter(r => moisFiltres.includes(r.checkin_date?.substring(0, 7)))
    : rows

  const log = { total: filtered.length, updated: 0, created: 0, errors: 0, skipped: 0 }
  const PAGE_SIZE = 1000

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 1 : charger tous les biens (map par nom ET par hospitable_id) Ã¢ÂÂÃ¢ÂÂ
  // Le CSV utilise property_name (ex: '416 "Harea"') qui = hospitable_name en base
  const bienByName = {}   // hospitable_name Ã¢ÂÂ bien_id
  const bienById = {}     // hospitable_id UUID Ã¢ÂÂ bien_id
  let bienPage = 0
  while (true) {
    const { data: bienData } = await supabase
      .from('bien')
      .select('id, hospitable_id, hospitable_name')
      .range(bienPage * PAGE_SIZE, (bienPage + 1) * PAGE_SIZE - 1)
    if (!bienData || bienData.length === 0) break
    for (const b of bienData) {
      if (b.hospitable_name) bienByName[b.hospitable_name.trim().toLowerCase()] = b.id
      if (b.hospitable_id) bienById[b.hospitable_id] = b.id
    }
    if (bienData.length < PAGE_SIZE) break
    bienPage++
  }

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 2 : charger TOUTES les rÃÂ©servations existantes avec pagination Ã¢ÂÂÃ¢ÂÂ
  const resaMap = {}
  const resaMapByHospId = {} // lookup secondaire par hospitable_id
  let page = 0
  while (true) {
    const { data: pageData } = await supabase
      .from('reservation')
      .select('id, code, hospitable_id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (!pageData || pageData.length === 0) break
    for (const r of pageData) {
      resaMap[r.code] = r.id
      if (r.hospitable_id) resaMapByHospId[r.hospitable_id] = r.id
    }
    if (pageData.length < PAGE_SIZE) break
    page++
  }

  onProgress?.({ step: 'prepare', pct: 10 })

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 3 : prÃÂ©parer toutes les lignes reservation Ã¢ÂÂÃ¢ÂÂ
  const toUpsert = []
  const toInsert = []

  for (const row of filtered) {
    const code = row.code?.trim()
    if (!code) { log.skipped++; continue }

    // Chercher le bien par nom (source CSV) Ã¢ÂÂ plus fiable que l'ID numÃÂ©rique
    const bienId = bienByName[row.property_name?.trim()?.toLowerCase()] || bienById[row.property_id]
    if (!bienId && !resaMap[code]) { log.skipped++; continue }

    const guestName  = [row.guest_first_name, row.guest_last_name].filter(Boolean).join(' ') || null
    const rawPhone   = row.guest_phone || row.phone || row.contact_phone || null
    const guestPhone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : null
    const guestCountry = row.guest_country || row.country || row.guest_nationality || null
    const guestCity    = row.guest_city || row.city || null
    const toC = v => v && parseFloat(v) !== 0 ? Math.round(parseFloat(v) * 100) : null

    const base = {
      code,
      guest_name: guestName,
      final_status: mapStatus(row.status),
      fin_revenue: toC(row.payout || row.revenue),
      fin_accommodation: toC(row.base_amount),
      fin_gross_revenue: toC(row.total_price),
      fin_host_service_fee: row.host_service_fee ? -Math.abs(Math.round(parseFloat(row.host_service_fee) * 100)) : null,
      fin_discount: toC(row.guest_discount),
      fin_adjusted: toC(row.adjusted_amount),
      ...(guestPhone   ? { guest_phone:   guestPhone }   : {}),
      ...(guestCountry ? { guest_country: guestCountry } : {}),
      ...(guestCity    ? { guest_city:    guestCity }    : {}),
    }

    const existingId = resaMap[code] || resaMapByHospId[row.uuid]
    if (existingId) {
      // Existe Ã¢ÂÂ update ciblÃÂ© par id (pas d'upsert pour ÃÂ©viter les contraintes NOT NULL)
      toUpsert.push({ id: existingId, ...base })
    } else {
      // Nouvelle Ã¢ÂÂ insert complet avec hospitable_id depuis le champ uuid du CSV
      toInsert.push({
        ...base,
        hospitable_id: row.uuid || null,
        bien_id: bienId,
        platform: (row.platform === 'booking.com' ? 'booking' : row.platform),
        arrival_date: row.checkin_date || null,
        departure_date: row.checkout_date || null,
        nights: row.nights ? parseInt(row.nights) : null,
        guest_count: row.guest_count ? parseInt(row.guest_count) : null,
        mois_comptable: row.checkin_date?.substring(0, 7) || null,
      })
    }
  }

  onProgress?.({ step: 'upsert', pct: 20 })

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 4 : updates individuels en parallÃÂ¨le (batch de 50) Ã¢ÂÂÃ¢ÂÂ
  const BULK = 500
  const UPDATE_BATCH = 50
  for (let i = 0; i < toUpsert.length; i += UPDATE_BATCH) {
    const batch = toUpsert.slice(i, i + UPDATE_BATCH)
    const results = await Promise.all(
      batch.map(({ id, ...fields }) =>
        supabase.from('reservation').update(fields).eq('id', id)
      )
    )
    const errs = results.filter(r => r.error).length
    log.errors += errs
    log.updated += batch.length - errs
    onProgress?.({ step: 'upsert', pct: 20 + Math.round((i / Math.max(toUpsert.length, 1)) * 30) })
  }

  for (let i = 0; i < toInsert.length; i += BULK) {
    const batch = toInsert.slice(i, i + BULK)
    const { data: inserted, error } = await supabase.from('reservation').insert(batch).select('id, code')
    if (error) {
      // Retry individuel pour identifier les lignes exactes en erreur
      for (const row of batch) {
        const { data: d, error: e } = await supabase.from('reservation').insert(row).select('id, code').maybeSingle()
        if (e) {
          log.errors++
          log.errorDetails = log.errorDetails || []
          log.errorDetails.push({ code: row.code, platform: row.platform, message: e.message })
        } else if (d) {
          log.created++
          resaMap[d.code] = d.id
        }
      }
    } else {
      log.created += batch.length
      for (const r of inserted || []) resaMap[r.code] = r.id
    }
    onProgress?.({ step: 'insert', pct: 50 + Math.round((i / Math.max(toInsert.length, 1)) * 10) })
  }

  onProgress?.({ step: 'fees', pct: 60 })

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 5 : prÃÂ©parer toutes les fees en bulk Ã¢ÂÂÃ¢ÂÂ
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

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 6 : supprimer les anciennes fees en bulk par batch Ã¢ÂÂÃ¢ÂÂ
  const CLEAN_BATCH = 200
  for (let i = 0; i < resaIdsToClean.length; i += CLEAN_BATCH) {
    const ids = resaIdsToClean.slice(i, i + CLEAN_BATCH)
    const { error: delError } = await supabase.from('reservation_fee').delete().in('reservation_id', ids)
    if (delError) throw new Error(`CF-I2 : DELETE reservation_fee echoue (batch ids=${ids.slice(0,3).join(',')}) : ${delError.message}`)
    onProgress?.({ step: 'clean_fees', pct: 60 + Math.round((i / resaIdsToClean.length) * 15) })
  }

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 7 : insÃÂ©rer les nouvelles fees en bulk Ã¢ÂÂÃ¢ÂÂ
  for (let i = 0; i < allFees.length; i += BULK) {
    const batch = allFees.slice(i, i + BULK)
    const { error: insError } = await supabase.from('reservation_fee').insert(batch)
    if (insError) throw new Error(`CF-I2 : INSERT reservation_fee echoue (batch ${i}-${i+BULK}, ${batch.length} fees) : ${insError.message}`)
    onProgress?.({ step: 'insert_fees', pct: 75 + Math.round((i / Math.max(allFees.length, 1)) * 15) })
  }

  onProgress?.({ step: 'dedup', pct: 90 })

  // Ã¢ÂÂÃ¢ÂÂ ÃÂtape 8 : fusion doublons Ã¢ÂÂÃ¢ÂÂ
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
  add('Guest Service Fee', row.guest_service_fee, 'guest_fee', 'Service fees')
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
        // CF-I1 : migrations sequentielles â aucun DELETE si une migration echoue
        const { error: e1 } = await supabase.from('reservation_fee').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        if (e1) throw new Error(`CF-I1 : migration reservation_fee echouee (slave=${slave.id}) : ${e1.message}`)

        const { error: e2 } = await supabase.from('ventilation').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        if (e2) throw new Error(`CF-I1 : migration ventilation echouee (slave=${slave.id}) : ${e2.message}`)

        const { error: e3 } = await supabase.from('reservation_paiement').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        if (e3) throw new Error(`CF-I1 : migration reservation_paiement echouee (slave=${slave.id}) : ${e3.message}`)

        const { error: e4 } = await supabase.from('payout_reservation').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        if (e4) throw new Error(`CF-I1 : migration payout_reservation echouee (slave=${slave.id}) : ${e4.message}`)

        const { error: e5 } = await supabase.from('mission_menage').update({ reservation_id: master.id }).eq('reservation_id', slave.id)
        if (e5) throw new Error(`CF-I1 : migration mission_menage echouee (slave=${slave.id}) : ${e5.message}`)

        // Toutes les migrations ont reussi â suppression du slave
        const { error: eDel } = await supabase.from('reservation').delete().eq('id', slave.id)
        if (eDel) throw new Error(`CF-I1 : DELETE slave echoue apres migrations reussies (slave=${slave.id}) : ${eDel.message}`)
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
