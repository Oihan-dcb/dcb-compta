/**
 * importAirbnb.js - Import CSV Airbnb Transaction History
 *
 * Usage : importer le fichier exporté depuis
 *   Airbnb > Tableau de bord hôte > Transactions > Exporter (par propriétaire)
 *
 * Fonctionnement :
 * - Chaque ligne Payout = un virement Airbnb (date + montant total)
 * - Chaque ligne Réservation = une resa dans ce virement (code HMxxx + montant net)
 * - On stocke une airbnb_payout_line par (confirmation_code, payout_date)
 * - Si le mouvement bancaire existe → on le lie
 * - Sinon → on stocke la ligne sans mouvement (payout futur)
 * - Complément au système synthétique, pas un remplacement
 */
import { supabase } from '../lib/supabase'

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += ch }
  }
  result.push(current.trim())
  return result
}

function parseDate(s) {
  if (!s || s === '-') return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  // MM/DD/YYYY (format Airbnb)
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return m[3] + '-' + m[1] + '-' + m[2]
  return null
}

function parseAmount(s) {
  if (!s || s === '-') return 0
  return parseFloat(String(s).replace(',', '.').trim()) || 0
}

/**
 * Parse le CSV Airbnb et retourne les lignes groupées par payout_date
 * Chaque groupe contient : { payoutDate, totalCents, rows: [{confirmationCode, amountCents, ...}] }
 */
export function parseAirbnbCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) throw new Error('Fichier vide')

  const headers = parseCSVLine(lines[0])
  const h = headers.map(x => x.toLowerCase())

  const iDate     = h.findIndex(x => x === 'date')
  const iType     = h.findIndex(x => x.includes('type'))
  const iCode     = h.findIndex(x => x.includes('code de confirmation'))
  const iCheckin  = h.findIndex(x => x.includes('date de début'))
  const iCheckout = h.findIndex(x => x.includes('date de fin'))
  const iGuest    = h.findIndex(x => x === 'voyageur')
  const iProp     = h.findIndex(x => x === 'logement')
  const iMontant  = h.findIndex(x => x === 'montant')
  const iVerse    = h.findIndex(x => x === 'versé')

  if (iDate < 0 || iType < 0) throw new Error('Format CSV Airbnb non reconnu')

  const groups = {} // payout_date → { totalCents, rows[] }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const type = (cols[iType] || '').toLowerCase()
    const date = parseDate(cols[iDate] || '')
    if (!date) continue

    if (type === 'payout') {
      const total = Math.round(parseAmount(cols[iVerse] || '0') * 100)
      if (!groups[date]) groups[date] = { payoutDate: date, totalCents: 0, rows: [] }
      groups[date].totalCents += total
    } else if (type === 'réservation' || type === 'reservation') {
      const code = (cols[iCode] || '').trim()
      if (!code) continue
      const amount = Math.round(parseAmount(cols[iMontant] || '0') * 100)
      if (!groups[date]) groups[date] = { payoutDate: date, totalCents: 0, rows: [] }
      groups[date].rows.push({
        confirmation_code: code,
        payout_date:       date,
        amount_cents:      amount,
        guest_name:        cols[iGuest] || null,
        property_name:     cols[iProp] || null,
        checkin:           parseDate(cols[iCheckin] || '') || null,
        checkout:          parseDate(cols[iCheckout] || '') || null,
      })
    }
  }

  return groups
}

/**
 * Importe un CSV Airbnb :
 * 1. Parse le CSV
 * 2. Pour chaque payout_date, cherche le mouvement bancaire Airbnb (±5j)
 * 3. Insère les lignes avec ou sans mouvement_id
 * 4. Met à jour les lignes orphelines existantes si le mouvement est trouvé
 */
export async function importAirbnbCSV(csvText) {
  const log = { parsed: 0, matched: 0, inserted: 0, orphans: 0, errors: 0, details: [] }

  try {
    const groups = parseAirbnbCSV(csvText)
    const allDates = Object.keys(groups).sort()
    log.parsed = Object.values(groups).reduce((s, g) => s + g.rows.length, 0)

    if (!allDates.length) {
      log.details.push('Aucune ligne trouvée dans le CSV')
      return log
    }

    const dateMin = allDates[0]
    const dMax = new Date(allDates[allDates.length - 1])
    dMax.setDate(dMax.getDate() + 5)
    const dateMax = dMax.toISOString().slice(0, 10)

    // Chercher les mouvements Airbnb dans la fenêtre
    const { data: mouvs } = await supabase
      .from('mouvement_bancaire')
      .select('id, credit, date_operation, statut_matching')
      .eq('canal', 'airbnb')
      .gte('date_operation', dateMin)
      .lte('date_operation', dateMax)
      .order('date_operation')

    const usedMouvIds = new Set()

    for (const date of allDates) {
      const group = groups[date]
      if (!group.rows.length) continue

      const pdateMs = new Date(date).getTime()

      // Trouver le mouvement bancaire correspondant (montant = totalCents ±2 centimes, fenêtre 5j)
      const mouv = mouvs?.find(m => {
        if (usedMouvIds.has(m.id)) return false
        const diff = (new Date(m.date_operation).getTime() - pdateMs) / 86400000
        if (diff < 0 || diff > 5) return false
        return Math.abs(m.credit - group.totalCents) <= 2
      })

      if (!mouv) {
        // Stocker les lignes sans mouvement (payout futur ou relevé non importé)
        const { error } = await supabase
          .from('airbnb_payout_line')
          .upsert(
            group.rows.map(r => ({ ...r, mouvement_id: null })),
            { onConflict: 'confirmation_code,payout_date', ignoreDuplicates: true }
          )
        if (error) { log.errors++; log.details.push('Erreur orphan ' + date + ': ' + error.message) }
        else {
          log.orphans += group.rows.length
          log.details.push('Payout Airbnb ' + date + ' stocké sans mouvement (' + group.rows.length + ' ligne(s))')
        }
        continue
      }

      usedMouvIds.add(mouv.id)
      log.matched++

      // Mettre à jour les éventuelles lignes orphelines existantes
      const codes = group.rows.map(r => r.confirmation_code)
      await supabase
        .from('airbnb_payout_line')
        .update({ mouvement_id: mouv.id })
        .eq('payout_date', date)
        .in('confirmation_code', codes)
        .is('mouvement_id', null)

      // Upsert avec mouvement_id
      const { error } = await supabase
        .from('airbnb_payout_line')
        .upsert(
          group.rows.map(r => ({ ...r, mouvement_id: mouv.id })),
          { onConflict: 'confirmation_code,payout_date', ignoreDuplicates: false }
        )

      if (error) {
        log.errors++
        log.details.push('Erreur ' + date + ': ' + error.message)
        continue
      }

      log.inserted += group.rows.length
      const props = [...new Set(group.rows.map(r => r.property_name).filter(Boolean))]
      log.details.push(
        'Airbnb ' + date + ' | ' + group.rows.length + ' resa(s) | ' +
        (group.totalCents / 100).toFixed(2) + '€' +
        (props.length ? ' | ' + props.slice(0, 2).join(', ') : '')
      )
    }

  } catch (e) {
    log.errors++
    log.details.push('Erreur: ' + e.message)
  }

  return log
}
