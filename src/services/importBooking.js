/**
 * importBooking.js - Import CSV Booking.com Payout
 *
 * Usage : importer le fichier "Payout_from_XXXX_until_XXXX.csv"
 * telecharge depuis Booking.com Extranet > Finance > Transactions
 *
 * Anti-doublons :
 * - Contrainte UNIQUE (mouvement_id, booking_ref, payout_date) en base
 * - Upsert ignoreDuplicates : reimporter = 0 insertion parasite
 * - Chevauchement de periodes : lignes deja presentes ignorees silencieusement
 *
 * Matching mouvement bancaire :
 * - Payout date CSV = date_operation bancaire - 1 a 4 jours
 * - Fenetre de 5 jours apres la payout date
 */
import { supabase } from '../lib/supabase'

function parseCSVLine(line, sep = ',') {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseFloat2(s) {
  if (!s || s === '-') return 0
  return parseFloat(String(s).replace(',', '.').replace(' ', '')) || 0
}

function parseDate(s) {
  if (!s || s === '-') return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m2 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m2) return m2[3] + '-' + m2[2] + '-' + m2[1]
  const m3 = t.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (m3) return '20' + m3[3] + '-' + m3[2] + '-' + m3[1]
  return null
}

/**
 * Parse le CSV Booking.com et retourne les lignes groupees par payout_date
 */
export function parseBookingCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) throw new Error('Fichier vide')

  const sep = lines[0].includes(';') ? ';' : ','
  const headers = parseCSVLine(lines[0], sep)

  const colIdx = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()))
  const col = (fr, en) => { const i = colIdx(fr); return i >= 0 ? i : colIdx(en) }

  const iPayoutDate = col('Date du versement',              'Payout date')
  const iRef        = col('Numéro de référence',            'Reference number')
  const iCheckin    = col("Date d'arrivée",                 'Check-in date')
  const iCheckout   = col('Date de départ',                 'Check-out date')
  const iProp       = col("Nom de l'établissement",         'Property name')
  const iPropId     = col("Identifiant de l'établissement", 'Property ID')
  const iAmount     = col('Montant du versement',           'Payable amount')
  const iGross      = col('Montant brut',                   'Gross amount')
  const iComm       = col('Commission',                     'Commission')
  const iStatus     = col('Statut de la réservation',       'Reservation status')
  const iType       = col('Type/Type de transaction',        'Type')

  if (iPayoutDate < 0) throw new Error('Colonne "Payout date" / "Date du versement" introuvable')
  if (iAmount < 0)     throw new Error('Colonne "Payable amount" / "Montant du versement" introuvable')

  const isPayoutRow = (type) =>
    type?.toLowerCase().includes('payout') || type === '(Payout)'

  const isReservationRow = (type) =>
    type?.toLowerCase().includes('reservation') ||
    type?.toLowerCase().includes('réservation')

  const rowsByPayoutDate = {}
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], sep)
    const rowType = iType >= 0 ? (cols[iType] || '') : null
    if (rowType !== null && !isPayoutRow(rowType)) continue
    const pdate = parseDate(cols[iPayoutDate])
    if (!pdate) continue

    const ref = cols[iRef] ? cols[iRef].replace(/^-$/, '').trim() || null : null
    const status = cols[iStatus] && cols[iStatus] !== '-' ? cols[iStatus] : null

    if (!rowsByPayoutDate[pdate]) rowsByPayoutDate[pdate] = []
    rowsByPayoutDate[pdate].push({
      payout_date:        pdate,
      booking_ref:        ref,
      checkin:            parseDate(cols[iCheckin]  || ''),
      checkout:           parseDate(cols[iCheckout] || ''),
      property_name:      cols[iProp]   || null,
      property_id:        cols[iPropId] || null,
      amount_cents:       Math.round(parseFloat2(cols[iAmount] || '0') * 100),
      gross_cents:        Math.round(parseFloat2(cols[iGross]  || '0') * 100),
      commission_cents:   Math.round(parseFloat2(cols[iComm]   || '0') * 100),
      reservation_status: status,
    })
  }

  return rowsByPayoutDate
}

/**
 * Importe un CSV Booking.com :
 * 1. Parse le CSV
 * 2. Pour chaque payout_date, cherche le mouvement bancaire (+1 a 5j)
 * 3. Insere les lignes (ignore doublons via contrainte UNIQUE)
 * 4. Marque les mouvements comme rapproches
 */
export async function importBookingCSV(csvText) {
  const log = { parsed: 0, matched: 0, inserted: 0, already_existing: 0, errors: 0, details: [] }

  try {
    const rowsByPayoutDate = parseBookingCSV(csvText)
    const allPayoutDates = Object.keys(rowsByPayoutDate).sort()
    log.parsed = Object.values(rowsByPayoutDate).reduce((s, r) => s + r.length, 0)

    if (!allPayoutDates.length) {
      log.details.push('Aucune payout date trouvee dans le CSV')
      return log
    }

    const dateMin = allPayoutDates[0]
    const dateMax = allPayoutDates[allPayoutDates.length - 1]
    const d = new Date(dateMax)
    d.setDate(d.getDate() + 5)
    const dateMaxStr = d.toISOString().slice(0, 10)

    const { data: mouvs } = await supabase
      .from('mouvement_bancaire')
      .select('id, credit, date_operation, statut_matching')
      .eq('canal', 'booking')
      .gte('date_operation', dateMin)
      .lte('date_operation', dateMaxStr)
      .order('date_operation')

    if (!mouvs?.length) {
      log.details.push('Aucun mouvement Booking entre ' + dateMin + ' et ' + dateMaxStr)
    }

    const usedMouvIds = new Set()

    for (const pdate of allPayoutDates) {
      const rows = rowsByPayoutDate[pdate]
      const pdateMs = new Date(pdate).getTime()

      const mouv = mouvs?.find(m => {
        if (usedMouvIds.has(m.id)) return false
        const diff = (new Date(m.date_operation).getTime() - pdateMs) / 86400000
        return diff >= 0 && diff <= 5
      })

      if (!mouv) {
        log.details.push('Pas de mouvement pour payout_date ' + pdate + ' (' + rows.length + ' lignes ignorees)')
        continue
      }

      usedMouvIds.add(mouv.id)
      log.matched++

      const toInsert = rows.map(r => ({ ...r, mouvement_id: mouv.id, guest_name: null }))

      const { error } = await supabase
        .from('booking_payout_line')
        .upsert(toInsert, {
          onConflict: 'mouvement_id,booking_ref,payout_date',
          ignoreDuplicates: true,
        })

      if (error) {
        log.errors++
        log.details.push('Erreur ' + pdate + ': ' + error.message)
        continue
      }

      log.inserted += toInsert.length
      log.matched++

      const nbResas = rows.filter(r => r.booking_ref).length
      const totalComm = rows.reduce((s, r) => s + Math.abs(r.commission_cents), 0)
      const props = [...new Set(rows.filter(r => r.property_name).map(r => r.property_name))]
      const detail = 'Booking | ' + nbResas + ' resa(s) | commission: ' + (totalComm / 100).toFixed(2) + String.fromCharCode(8364) + (props.length ? ' | ' + props.slice(0, 2).join(', ') : '')

      await supabase
        .from('mouvement_bancaire')
        .update({ statut_matching: 'rapproche', detail })
        .eq('id', mouv.id)
    }

  } catch (e) {
    log.errors++
    log.details.push('Erreur: ' + e.message)
  }

  return log
}
