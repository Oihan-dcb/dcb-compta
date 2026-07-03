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
import { AGENCE } from '../lib/agence'
import { propagerRapprochementResas } from './rapprochement'

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

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }

function parseDate(s) {
  if (!s || s === '-') return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m2 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m2) return m2[3] + '-' + m2[2] + '-' + m2[1]
  const m3 = t.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (m3) return '20' + m3[3] + '-' + m3[2] + '-' + m3[1]
  // Format Booking nouveau : "1 Jun 2026" ou "27 May 2026"
  const m4 = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/)
  if (m4) {
    const mo = MONTHS[m4[2].toLowerCase()]
    if (mo) return m4[3] + '-' + mo + '-' + m4[1].padStart(2, '0')
  }
  return null
}

/**
 * Détecte si le CSV est le nouveau format "par payout" (Finance > Payouts > détail).
 * Critère : présence d'une colonne "Payout ID" dans les en-têtes.
 * Ce format contient guest_name, tourism_tax, service_fee et payout_id.
 */
function isNewPayoutFormat(headers) {
  return headers.some(h => h.toLowerCase().replace(/\s/g, '') === 'payoutid')
}

/**
 * Parse le nouveau format CSV Booking.com (Finance > Payouts > détail par payout).
 * En-têtes : Type, Booking number, Check-in, Checkout, Guest name, Reservation status,
 *            Currency, Payment status, Tourism tax, Amount, Commission,
 *            Payments Service Fee, Net, Payout date, Payout ID
 * Toutes les lignes sont de type "Reservation" (pas de ligne "Payout" résumé).
 * Retourne rowsByPayoutDate avec payout_id, guest_name, tourism_tax_cents, service_fee_cents.
 */
function parseBookingPayoutDetailCSV(lines, sep, headers) {
  const colIdx = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()))

  const iType        = colIdx('Type')
  const iBookingNum  = colIdx('Booking number')
  const iCheckin     = colIdx('Check-in')
  const iCheckout    = colIdx('Checkout')
  const iGuestName   = colIdx('Guest name')
  const iStatus      = colIdx('Reservation status')
  const iTourismTax  = colIdx('Tourism tax')
  const iAmount      = colIdx('Amount')       // montant brut
  const iComm        = colIdx('Commission')
  const iServiceFee  = colIdx('Payments Service Fee')
  const iNet         = colIdx('Net')          // montant net = amount_cents
  const iPayoutDate  = colIdx('Payout date')
  const iPayoutId    = colIdx('Payout ID')

  if (iPayoutDate < 0) throw new Error('Colonne "Payout date" introuvable')
  if (iNet < 0)        throw new Error('Colonne "Net" introuvable')
  if (iBookingNum < 0) throw new Error('Colonne "Booking number" introuvable')

  const rowsByPayoutDate = {}
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], sep)
    const rowType = iType >= 0 ? (cols[iType] || '').toLowerCase() : 'reservation'
    if (!rowType.includes('reservation')) continue

    const pdate    = parseDate(cols[iPayoutDate] || '')
    if (!pdate) continue
    const ref      = cols[iBookingNum] ? cols[iBookingNum].trim() || null : null
    const payoutId = iPayoutId >= 0 && cols[iPayoutId] ? cols[iPayoutId].trim() || null : null
    const status   = iStatus >= 0 && cols[iStatus] && cols[iStatus] !== '-' ? cols[iStatus] : null

    if (!rowsByPayoutDate[pdate]) rowsByPayoutDate[pdate] = []
    rowsByPayoutDate[pdate].push({
      payout_date:        pdate,
      payout_id:          payoutId,
      booking_ref:        ref,
      checkin:            parseDate(cols[iCheckin]    || ''),
      checkout:           parseDate(cols[iCheckout]   || ''),
      property_name:      null,   // absent de ce format
      property_id:        null,
      guest_name:         iGuestName >= 0 ? (cols[iGuestName] || null) : null,
      amount_cents:       Math.round(parseFloat2(cols[iNet]        || '0') * 100),
      gross_cents:        Math.round(parseFloat2(cols[iAmount]     || '0') * 100),
      commission_cents:   Math.round(Math.abs(parseFloat2(cols[iComm]       || '0')) * 100),
      tourism_tax_cents:  Math.round(Math.abs(parseFloat2(iTourismTax >= 0 ? cols[iTourismTax] || '0' : '0')) * 100),
      service_fee_cents:  Math.round(Math.abs(parseFloat2(iServiceFee >= 0 ? cols[iServiceFee] || '0' : '0')) * 100),
      reservation_status: status,
    })
  }
  return rowsByPayoutDate
}

/**
 * Parse le CSV Booking.com et retourne les lignes groupees par payout_date
 */
export function parseBookingCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) throw new Error('Fichier vide')

  // Booking.com exporte parfois en TSV (onglets) malgré l'extension .csv
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const headers = parseCSVLine(lines[0], sep)

  // Nouveau format "par payout" — déléguer au parser dédié
  if (isNewPayoutFormat(headers)) {
    return parseBookingPayoutDetailCSV(lines, sep, headers)
  }

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
  // Numéro de réservation individuel (col distincte du ref payout)
  const iResaRef    = (() => {
    for (const name of ['Numéro de réservation', 'Reservation number', 'Confirmation number', 'Booking number']) {
      const i = colIdx(name)
      if (i >= 0 && i !== iRef) return i
    }
    // Fallback positionnel : colonne entre payout ref et check-in
    if (iRef >= 0 && iCheckin > iRef + 1) return iRef + 1
    return -1
  })()

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
    const isPayout = isPayoutRow(rowType)
    const isResa   = isReservationRow(rowType)
    // Traiter les lignes Payout (résumé) ET les lignes Reservation (détail par résa)
    if (rowType !== null && !isPayout && !isResa) continue
    const pdate = parseDate(cols[iPayoutDate])
    if (!pdate) continue

    // Pour les lignes Reservation : utiliser le numéro de réservation comme booking_ref
    // Pour les lignes Payout : utiliser le ref payout (compatibilité anciens fichiers)
    let ref
    if (isResa && iResaRef >= 0) {
      ref = cols[iResaRef] ? cols[iResaRef].replace(/^-$/, '').trim() || null : null
    } else {
      ref = cols[iRef] ? cols[iRef].replace(/^-$/, '').trim() || null : null
    }

    const status = cols[iStatus] && cols[iStatus] !== '-' ? cols[iStatus] : null

    if (!rowsByPayoutDate[pdate]) rowsByPayoutDate[pdate] = []
    rowsByPayoutDate[pdate].push({
      payout_date:        pdate,
      payout_id:          null,
      booking_ref:        ref,
      checkin:            parseDate(cols[iCheckin]  || ''),
      checkout:           parseDate(cols[iCheckout] || ''),
      property_name:      cols[iProp]   || null,
      property_id:        cols[iPropId] || null,
      guest_name:         null,
      amount_cents:       Math.round(parseFloat2(cols[iAmount] || '0') * 100),
      gross_cents:        Math.round(parseFloat2(cols[iGross]  || '0') * 100),
      commission_cents:   Math.round(parseFloat2(cols[iComm]   || '0') * 100),
      tourism_tax_cents:  0,
      service_fee_cents:  0,
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
      .select('id, credit, date_operation, statut_matching, libelle, detail')
      .eq('canal', 'booking')
      // Ne matcher que les virements du compte de L'AGENCE COURANTE — sans ce filtre,
      // un CSV Booking Lauian pouvait se coller sur un virement DCB (cas Sinnika 02/07/2026)
      .eq('agence', AGENCE)
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

      // Nouveau format : match exact via Payout ID extrait du libellé bancaire (NO.{payout_id})
      const firstPayoutId = rows.find(r => r.payout_id)?.payout_id
      let mouv = null
      if (firstPayoutId) {
        mouv = mouvs?.find(m => {
          if (usedMouvIds.has(m.id)) return false
          const lib = ((m.libelle || '') + ' ' + (m.detail || '')).toUpperCase()
          return lib.includes('NO.' + firstPayoutId.toUpperCase())
        })
      }
      // Fallback : match par date (anciens fichiers ou payout_id absent)
      // Garde-fou montant : la somme des nets du payout doit ≈ le crédit bancaire (±2 €),
      // comme importAirbnb et _promouvoirBookingLignes. Sans lui, un payout dont le virement
      // n'est pas encore arrivé se collait par date sur le virement d'un AUTRE payout
      // (cas Sinnika 02/07/2026 : payout 1 369,25 € rattaché au virement 8 427,32 €).
      if (!mouv) {
        const sommeNets = rows.reduce((s, r) => s + (r.amount_cents || 0), 0)
        mouv = mouvs?.find(m => {
          if (usedMouvIds.has(m.id)) return false
          const diff = (new Date(m.date_operation).getTime() - pdateMs) / 86400000
          return diff >= 0 && diff <= 5 && Math.abs(m.credit - sommeNets) <= 200
        })
      }

      if (!mouv) {
        // Stocker les lignes sans mouvement bancaire (payout futur ou relevé non importé)
        const orphans = rows.filter(r => r.booking_ref).map(r => ({ ...r, mouvement_id: null }))
        if (orphans.length) {
          await supabase
            .from('booking_payout_line')
            .upsert(orphans, { onConflict: 'booking_ref,payout_date', ignoreDuplicates: true })
          log.details.push('Payout ' + pdate + ' stocké sans mouvement (' + orphans.length + ' ligne(s) — relevé bancaire manquant)')
        } else {
          log.details.push('Pas de mouvement pour payout_date ' + pdate + ' (' + rows.length + ' lignes ignorées)')
        }
        continue
      }

      usedMouvIds.add(mouv.id)
      log.matched++

      // Si des lignes orphelines existent déjà pour ce payout, les mettre à jour avec le mouvement
      const refs = rows.filter(r => r.booking_ref).map(r => r.booking_ref)
      if (refs.length) {
        await supabase
          .from('booking_payout_line')
          .update({ mouvement_id: mouv.id })
          .eq('payout_date', pdate)
          .in('booking_ref', refs)
          .is('mouvement_id', null)
      }

      // N'insérer QUE les lignes réservation (booking_ref non-null). Les lignes "résumé
      // payout" (booking_ref NULL) se dupliquent à chaque ré-import — la contrainte
      // UNIQUE(booking_ref, payout_date) ne dédoublonne pas les NULL en Postgres — et
      // l'enrichissement les ignore. On ne les stocke donc pas.
      const toInsert = rows.filter(r => r.booking_ref).map(r => ({ ...r, mouvement_id: mouv.id }))

      const { error } = toInsert.length ? await supabase
        .from('booking_payout_line')
        .upsert(toInsert, {
          onConflict: 'booking_ref,payout_date',
          ignoreDuplicates: false,
        }) : { error: null }

      if (error) {
        log.errors++
        log.details.push('Erreur ' + pdate + ': ' + error.message)
        continue
      }

      log.inserted += toInsert.length
      log.matched++

      const nbResas = rows.filter(r => r.booking_ref).length
      const totalComm = rows.reduce((s, r) => s + Math.abs(r.commission_cents), 0)
      const totalTax  = rows.reduce((s, r) => s + (r.tourism_tax_cents || 0), 0)
      const props = [...new Set(rows.filter(r => r.property_name).map(r => r.property_name))]
      const pidSuffix = firstPayoutId ? ' | ref: ' + firstPayoutId : ''
      const taxSuffix = totalTax > 0 ? ' | taxe séjour: ' + (totalTax / 100).toFixed(2) + String.fromCharCode(8364) : ''
      const detail = 'Booking | ' + nbResas + ' resa(s) | commission: ' + (totalComm / 100).toFixed(2) + String.fromCharCode(8364) + taxSuffix + (props.length ? ' | ' + props.slice(0, 2).join(', ') : '') + pidSuffix

      await supabase
        .from('mouvement_bancaire')
        .update({ statut_matching: 'rapproche', detail })
        .eq('id', mouv.id)

      // Propager au niveau réservation (reservation_paiement + rapprochee) —
      // sinon la résa reste « sans virement » dans son mois comptable jusqu'à
      // l'ouverture de la page Rapprochement du mois du mouvement
      const nProp = await propagerRapprochementResas(
        mouv, 'booking',
        rows.filter(r => r.booking_ref).map(r => ({ ref: r.booking_ref, amount_cents: r.amount_cents }))
      )
      if (nProp) log.details.push(nProp + ' réservation(s) marquée(s) rapprochée(s)')
    }

  } catch (e) {
    log.errors++
    log.details.push('Erreur: ' + e.message)
  }

  return log
}
