/**
 * importBooking.js - Import du relevé de versements Booking.com (CSV ou XLSX)
 *
 * Fichiers acceptés (extranet Booking › Finances › Versements, DCB ou Lauïan) :
 *  - détail d'un versement « <payout_id>.csv » (FR ou EN, colonne « Identifiant du paiement »)
 *  - ancien relevé « Payout_from_XXXX_until_XXXX.csv » (Finance › Transactions)
 *  - les mêmes en .xlsx / .xls
 * Flux (lot L0, 19/10/2026) : preparerImportBooking(fichiers) → aperçu (rien d'écrit) →
 * validerImportBooking(analyse) → écritures idempotentes. Le noyau pur est bookingReleveCore.js.
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
import { regrouperParVersement, analyserReleveBooking, detailMouvementBooking, suiviVirementsBooking } from './bookingReleveCore'

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

// Ex. "Réservation" → "reservation" -- nécessaire car les exports Booking en locale FR
// utilisent des libellés accentués que .includes('reservation') ne matche jamais tel quel.
function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const MONTHS = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  // Abréviations françaises (export CSV Booking en locale FR, ex. "24 juil. 2026", "1 août 2026")
  janv:'01', fevr:'02', mars:'03', avr:'04', mai:'05', juin:'06', juil:'07', aout:'08', sept:'09',
}

function parseDate(s) {
  if (!s || s === '-') return null
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m2 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m2) return m2[3] + '-' + m2[2] + '-' + m2[1]
  const m3 = t.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (m3) return '20' + m3[3] + '-' + m3[2] + '-' + m3[1]
  // Format Booking nouveau : "1 Jun 2026" (EN) ou "24 juil. 2026" / "1 août 2026" (FR, point
  // d'abréviation optionnel + accents) -- longueur de mois variable, pas seulement 3 lettres
  const m4 = t.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})$/)
  if (m4) {
    const key = stripAccents(m4[2]).toLowerCase()
    const mo = MONTHS[key]
    if (mo) return m4[3] + '-' + mo + '-' + m4[1].padStart(2, '0')
  }
  return null
}

/**
 * Détecte si le CSV est le nouveau format "par payout" (Finance > Payouts > détail).
 * Critère : présence d'une colonne "Payout ID" (EN) ou "Identifiant du paiement" (FR export
 * en locale française, ex. téléchargé depuis l'extranet en français -- mêmes colonnes, mêmes
 * noms traduits, + une colonne "Prestataire de paiement" en plus, ignorée ci-dessous).
 */
function isNewPayoutFormat(headers) {
  return headers.some(h => {
    const norm = stripAccents(h).toLowerCase().replace(/\s/g, '')
    return norm === 'payoutid' || norm === 'identifiantdupaiement'
  })
}

/**
 * Parse le nouveau format CSV Booking.com (Finance > Payouts > détail par payout), EN ou FR.
 * En-têtes EN : Type, Booking number, Check-in, Checkout, Guest name, Reservation status,
 *               Currency, Payment status, Tourism tax, Amount, Commission,
 *               Payments Service Fee, Net, Payout date, Payout ID
 * En-têtes FR : Type, Numéro de réservation, Arrivée, Checkout, Nom du client,
 *               Prestataire de paiement, Statut de la réservation, Devise, Taxe de séjour,
 *               Statut du paiement, Montant, Commission, Frais de service de paiement, Net,
 *               Date du paiement, Identifiant du paiement
 * Toutes les lignes sont de type "Reservation"/"Réservation" (pas de ligne "Payout" résumé).
 * Retourne rowsByPayoutDate avec payout_id, guest_name, tourism_tax_cents, service_fee_cents.
 */
function parseBookingPayoutDetailCSV(lines, sep, headers) {
  const colIdx = (name) => headers.findIndex(h => stripAccents(h).toLowerCase().includes(stripAccents(name).toLowerCase()))
  const col = (fr, en) => { const i = colIdx(fr); return i >= 0 ? i : colIdx(en) }

  const iType        = col('Type', 'Type')
  const iBookingNum  = col('Numéro de réservation', 'Booking number')
  const iCheckin     = col('Arrivée', 'Check-in')
  const iCheckout    = col('Checkout', 'Checkout')
  const iGuestName   = col('Nom du client', 'Guest name')
  const iStatus      = col('Statut de la réservation', 'Reservation status')
  const iTourismTax  = col('Taxe de séjour', 'Tourism tax')
  const iAmount      = col('Montant', 'Amount')       // montant brut
  const iComm        = col('Commission', 'Commission')
  const iServiceFee  = col('Frais de service de paiement', 'Payments Service Fee')
  const iNet         = col('Net', 'Net')              // montant net = amount_cents
  const iPayoutDate  = col('Date du paiement', 'Payout date')
  const iPayoutId    = col('Identifiant du paiement', 'Payout ID')

  if (iPayoutDate < 0) throw new Error('Colonne "Payout date" introuvable')
  if (iNet < 0)        throw new Error('Colonne "Net" introuvable')
  if (iBookingNum < 0) throw new Error('Colonne "Booking number" introuvable')

  const rowsByPayoutDate = {}
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], sep)
    const rowType = iType >= 0 ? stripAccents(cols[iType] || '').toLowerCase() : 'reservation'
    // Lignes « résumé » (total du versement) : contrôle seulement, jamais stockées
    const estResume = rowType.includes('payout') || rowType.includes('versement')
    if (!rowType) continue

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
      type_ligne:         rowType,
      est_resume:         estResume,
    })
  }
  return rowsByPayoutDate
}

/**
 * Parse le CSV Booking.com et retourne les lignes groupees par payout_date
 */
export function parseBookingCSV(text) {
  let lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) throw new Error('Fichier vide')
  // Ligne d'en-tête = 1re ligne qui contient une colonne de date de versement (un export XLSX peut
  // commencer par un titre ou une ligne vide)
  const iEntete = lines.findIndex(l => /payout date|date du paiement|date du versement/i.test(stripAccents(l)))
  if (iEntete > 0) lines = lines.slice(iEntete)

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
  // "Montant du versement" = total du virement, présent UNIQUEMENT sur la ligne
  // "(Payout)" récapitulative — vide ("-") sur chaque ligne "Réservation". Le montant
  // net PAR résa (celui qu'on doit stocker) est dans "Montant payable" : la somme des
  // "Montant payable" de toutes les résas d'un payout == "Montant du versement" du
  // payout (vérifié sur données réelles, ex. 600.98+639.74=1240.72€). Utiliser la
  // mauvaise colonne mettait amount_cents=0 sur TOUTES les lignes réservation (bug
  // trouvé 2026-08-05 — cf. backfill migration/correction des lignes déjà importées).
  const iAmount     = col('Montant payable',                'Payable amount')
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
      type_ligne:         isPayout ? 'payout' : 'reservation',
      est_resume:         isPayout,
    })
  }

  return rowsByPayoutDate
}


// ── Lecture des fichiers (CSV ou XLSX) ───────────────────────────────────────

/** Contenu texte CSV d'un fichier déposé (File navigateur, ou { name, buffer } en script) */
export async function lireFichierBooking(file) {
  const nom = (file.name || '').toLowerCase()
  if (/\.xlsx?$/.test(nom)) {
    const XLSX = await import('xlsx')
    const buf = file.buffer || await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false })
    const ws = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_csv(ws, { FS: ',', blankrows: false })
  }
  if (file.text) return await file.text()
  return new TextDecoder('utf-8').decode(file.buffer)
}

/** Fusionne les lignes de plusieurs fichiers (même versement présent deux fois = une seule fois) */
function fusionnerFichiers(parses) {
  const out = {}
  const vues = new Set()
  for (const rowsByDate of parses) {
    for (const [d, rows] of Object.entries(rowsByDate)) {
      for (const r of rows) {
        const k = [r.payout_id || '', d, r.booking_ref || '', r.amount_cents, r.est_resume ? 'R' : 'L'].join('|')
        if (vues.has(k)) continue
        vues.add(k)
        ;(out[d] ||= []).push(r)
      }
    }
  }
  return out
}

async function enLots(ids, taille, fn) {
  const out = []
  for (let i = 0; i < ids.length; i += taille) out.push(...(await fn(ids.slice(i, i + taille))))
  return out
}

// ── Aperçu (aucune écriture) ─────────────────────────────────────────────────

/**
 * Lit les fichiers, charge le contexte (virements Booking de l'agence, résas, paiements, lignes
 * déjà importées, mois clôturés) et retourne l'analyse — RIEN n'est écrit.
 */
export async function preparerImportBooking(files) {
  const fichiers = []
  const parses = []
  for (const f of files) {
    try {
      const txt = await lireFichierBooking(f)
      const rows = parseBookingCSV(txt)
      parses.push(rows)
      fichiers.push({ nom: f.name, lignes: Object.values(rows).reduce((s, r) => s + r.length, 0), erreur: null })
    } catch (e) {
      fichiers.push({ nom: f.name, lignes: 0, erreur: e.message })
    }
  }
  const groupes = regrouperParVersement(fusionnerFichiers(parses))
  if (!groupes.length) return { fichiers, versements: [], resume: { versements: 0, lignes: 0, a_valider: 0 } }

  const dMin = groupes[0].payout_date
  const dMaxD = new Date(groupes[groupes.length - 1].payout_date); dMaxD.setDate(dMaxD.getDate() + 8)
  const dMax = dMaxD.toISOString().slice(0, 10)
  const { data: mouvements, error: eM } = await supabase.from('mouvement_bancaire')
    .select('id, date_operation, credit, libelle, detail, statut_matching, mois_releve')
    .eq('canal', 'booking').eq('agence', AGENCE).gt('credit', 0)
    .gte('date_operation', dMin).lte('date_operation', dMax)
  if (eM) throw eM

  const refs = [...new Set(groupes.flatMap(g => g.lignes.map(l => l.booking_ref)))]
  const reservations = await enLots(refs, 200, async lot => {
    const { data, error } = await supabase.from('reservation')
      .select('id, code, platform_id, fin_revenue, final_status, mois_comptable, rapprochee, departure_date, bien!inner(agence, code, gestion_loyer)')
      .eq('platform', 'booking').in('platform_id', lot)
    if (error) throw error
    return data || []
  })
  const paiements = await enLots(reservations.map(r => r.id), 200, async lot => {
    const { data, error } = await supabase.from('reservation_paiement').select('id, reservation_id, mouvement_id, montant').in('reservation_id', lot)
    if (error) throw error
    return data || []
  })
  const lignesExistantes = await enLots(refs, 200, async lot => {
    const { data, error } = await supabase.from('booking_payout_line')
      .select('id, booking_ref, payout_date, amount_cents, commission_cents, service_fee_cents, tourism_tax_cents, mouvement_id').in('booking_ref', lot)
    if (error) throw error
    return data || []
  })
  const { data: clotures } = await supabase.from('cloture_comptable').select('mois, cloture_rappro').eq('agence', AGENCE)
  const moisClotures = new Set((clotures || []).filter(c => c.cloture_rappro).map(c => c.mois))

  const analyse = analyserReleveBooking(groupes, { agence: AGENCE, mouvements: mouvements || [], reservations, paiements, lignesExistantes, moisClotures })
  return { fichiers, ...analyse, agence: AGENCE }
}

// ── Validation (écritures idempotentes) ──────────────────────────────────────

/**
 * Écrit les versements validables de l'analyse :
 *  - booking_payout_line (upsert sur booking_ref + payout_date : réimporter ne double rien)
 *  - reservation_paiement de chaque résa (VIRPayinProuvé) : créé si absent, montant corrigé au net
 *    Booking s'il diffère ; jamais touché si la résa est déjà sur un AUTRE virement ou si le mois est
 *    clôturé (listé « à régulariser »)
 *  - mouvement_bancaire : détail + statut « rapproché » seulement si Σ lignes = virement reçu
 * @param cles  sous-ensemble de versements à valider (défaut : tous les validables)
 */
export async function validerImportBooking(analyse, cles = null) {
  const log = { versements: 0, lignes: 0, paiements_crees: 0, paiements_corriges: 0, mouvements_rapproches: 0, a_regulariser: [], erreurs: [] }
  for (const v of analyse.versements) {
    if (!v.validable || (cles && !cles.includes(v.cle))) continue
    try {
      const mid = v.mouvement?.id || null
      const rows = v.lignes.map(l => ({
        mouvement_id: mid, payout_date: l.payout_date, payout_id: l.payout_id || v.payout_id || null,
        booking_ref: l.booking_ref, guest_name: l.guest_name || null, checkin: l.checkin, checkout: l.checkout,
        property_name: l.property_name || null, property_id: l.property_id || null,
        amount_cents: l.amount_cents, gross_cents: l.gross_cents || 0, commission_cents: l.commission_cents || 0,
        tourism_tax_cents: l.tourism_tax_cents || 0, service_fee_cents: l.service_fee_cents || 0,
        reservation_status: l.reservation_status || null,
      }))
      if (rows.length) {
        const { error } = await supabase.from('booking_payout_line').upsert(rows, { onConflict: 'booking_ref,payout_date', ignoreDuplicates: false })
        if (error) throw error
      }
      log.lignes += rows.length
      if (mid) {
        for (const l of v.lignes) {
          if (l.action_paiement === 'creer') {
            const complet = (l.fin_revenue || 0) === 0 || l.amount_cents >= (l.fin_revenue || 0) * 0.96
            const { error } = await supabase.from('reservation_paiement').upsert({
              reservation_id: l.resa_id, mouvement_id: mid, montant: l.amount_cents, date_paiement: v.mouvement.date_operation,
              type_paiement: complet ? 'total' : 'acompte', note: 'Relevé Booking ' + (v.payout_id || v.payout_date),
            }, { onConflict: 'reservation_id,mouvement_id', ignoreDuplicates: true })
            if (error) throw error
            if (complet) await supabase.from('reservation').update({ rapprochee: true }).eq('id', l.resa_id)
            log.paiements_crees++
          } else if (l.action_paiement === 'corriger_montant') {
            const { error } = await supabase.from('reservation_paiement').update({ montant: l.amount_cents })
              .eq('reservation_id', l.resa_id).eq('mouvement_id', mid)
            if (error) throw error
            log.paiements_corriges++
          }
        }
        const upd = { detail: detailMouvementBooking(v) }
        if (v.ecart_virement === 0 && v.lignes.every(l => l.resa_id)) upd.statut_matching = 'rapproche'
        const { error } = await supabase.from('mouvement_bancaire').update(upd).eq('id', mid)
        if (error) throw error
        if (upd.statut_matching) log.mouvements_rapproches++
      }
      log.a_regulariser.push(...v.a_regulariser)
      log.versements++
    } catch (e) {
      log.erreurs.push(`${v.payout_id || v.payout_date} : ${e.message}`)
    }
  }
  return log
}

// ── Suivi : quels virements Booking ont leur détail ───────────────────────────

export async function getSuiviVirementsBooking(depuis) {
  const { data: mouvements, error } = await supabase.from('mouvement_bancaire')
    .select('id, date_operation, credit, libelle, detail, statut_matching')
    .eq('canal', 'booking').eq('agence', AGENCE).gt('credit', 0).gte('date_operation', depuis)
    .order('date_operation', { ascending: false })
  if (error) throw error
  const ids = (mouvements || []).map(m => m.id)
  const paiements = await enLots(ids, 200, async lot => {
    const { data } = await supabase.from('reservation_paiement').select('mouvement_id, montant').in('mouvement_id', lot)
    return data || []
  })
  const lignes = await enLots(ids, 200, async lot => {
    const { data } = await supabase.from('booking_payout_line').select('mouvement_id, amount_cents').in('mouvement_id', lot).not('booking_ref', 'is', null)
    return data || []
  })
  return suiviVirementsBooking(mouvements || [], paiements, lignes)
}
