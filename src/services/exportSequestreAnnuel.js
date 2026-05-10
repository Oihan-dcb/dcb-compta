/**
 * Export CSV — Séquestre clôture annuelle
 * Reproduit la logique de SequestreCloture (PageComptabilite.jsx)
 */

import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const STATUT_LABEL = {
  certain:            'Certain',
  certain_manuel:     'Certain — manuel',
  booking_prevu:      'En attente de paiement par Booking',
  a_verifier_acompte: 'Acompte à contrôler',
  exclu_perimetre:    'Hors périmètre',
}

const CANAL_LABEL = {
  airbnb: 'Airbnb', booking: 'Booking', direct: 'Direct', manual: 'Manuel', stripe: 'Stripe',
}

function fmt(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR')
}

function fmtEuros(cents) {
  if (cents == null) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

export async function exportSequestreAnnuel(annee) {
  const dateCloture      = `${annee}-12-31`
  const dateDebutSuivant = `${annee + 1}-01-01`

  // 1. Biens de l'agence
  const { data: biensList } = await supabase
    .from('bien').select('id, code').eq('agence', AGENCE)
  const bienIds = (biensList || []).map(b => b.id)
  if (!bienIds.length) return ''

  // 2. Périmètre mensuel
  const { data: perimetreData } = await supabase
    .from('sequestre_perimetre_mensuel')
    .select('bien_id, mois, perception_loyer_plateforme')
    .in('bien_id', bienIds)
    .gte('mois', `${annee}-01`)
    .lte('mois', `${annee}-12`)
  const perimetreMap = {}
  for (const p of perimetreData || []) perimetreMap[`${p.bien_id}|${p.mois}`] = p.perception_loyer_plateforme

  const percevait = (bien_id, dateStr) => {
    if (!dateStr) return null
    const key = `${bien_id}|${dateStr.slice(0, 7)}`
    return key in perimetreMap ? perimetreMap[key] : true
  }

  // 3. Réservations arrivant en N+1
  const CANCELLED = ['not_accepted', 'not accepted', 'declined', 'expired', 'cancelled']
  let resasAll = []
  for (let i = 0; i < bienIds.length; i += 400) {
    const { data } = await supabase
      .from('reservation')
      .select('id, code, platform, arrival_date, departure_date, fin_revenue, guest_name, final_status, owner_stay, booking_date, bien:bien_id(id, code, hospitable_name)')
      .in('bien_id', bienIds.slice(i, i + 400))
      .gte('arrival_date', dateDebutSuivant)
    resasAll = resasAll.concat((data || []).filter(r =>
      !CANCELLED.includes(r.final_status) &&
      !r.owner_stay &&
      !/^[eé]tudiante?/i.test(r.guest_name || '')
    ))
  }
  if (!resasAll.length) return ''
  const resaIds = resasAll.map(r => r.id)

  // 4. VIR ventilations (Airbnb & Booking)
  const virByResa = {}
  for (let i = 0; i < resaIds.length; i += 400) {
    const { data: virs } = await supabase
      .from('ventilation')
      .select('reservation_id, mouvement:mouvement_id(date_operation)')
      .in('reservation_id', resaIds.slice(i, i + 400))
      .eq('code', 'VIR').not('mouvement_id', 'is', null)
    for (const v of virs || []) {
      if (!virByResa[v.reservation_id]) virByResa[v.reservation_id] = []
      virByResa[v.reservation_id].push(v)
    }
  }

  // Filtrer Airbnb sans VIRPayinProuvé
  resasAll = resasAll.filter(r => {
    if (r.platform === 'airbnb') {
      const virs = virByResa[r.id] || []
      return virs.some(v => v.mouvement?.date_operation && v.mouvement.date_operation <= dateCloture)
    }
    return true
  })

  // 5. booking_payout_line
  const bookingCodes = resasAll.filter(r => r.platform === 'booking').map(r => r.code).filter(Boolean)
  const bplByCode = {}
  for (let i = 0; i < bookingCodes.length; i += 400) {
    const { data: bpls } = await supabase
      .from('booking_payout_line')
      .select('booking_ref, payout_date, amount_cents')
      .in('booking_ref', bookingCodes.slice(i, i + 400))
    for (const b of bpls || []) {
      if (!bplByCode[b.booking_ref]) bplByCode[b.booking_ref] = b
    }
  }

  // 6. reservation_paiement
  const pmtByResa = {}
  for (let i = 0; i < resaIds.length; i += 400) {
    const { data: pmts } = await supabase
      .from('reservation_paiement')
      .select('reservation_id, montant, date_paiement')
      .in('reservation_id', resaIds.slice(i, i + 400))
    for (const p of pmts || []) {
      if (!pmtByResa[p.reservation_id]) pmtByResa[p.reservation_id] = []
      pmtByResa[p.reservation_id].push(p)
    }
  }

  // 7. stripe_payout_line
  const splCodes = resasAll.filter(r => r.platform === 'direct' || r.platform === 'stripe').map(r => r.code).filter(Boolean)
  const splByCode = {}
  for (let i = 0; i < splCodes.length; i += 400) {
    const { data: spls } = await supabase
      .from('stripe_payout_line')
      .select('reservation_code, created_at')
      .in('reservation_code', splCodes.slice(i, i + 400))
    for (const s of spls || []) {
      if (!splByCode[s.reservation_code]) splByCode[s.reservation_code] = { avant: false, minDate: null }
      if (s.created_at <= dateCloture) splByCode[s.reservation_code].avant = true
      if (!splByCode[s.reservation_code].minDate || s.created_at < splByCode[s.reservation_code].minDate)
        splByCode[s.reservation_code].minDate = s.created_at
    }
  }

  // 8. Classification (même logique que SequestreCloture)
  const lignes = resasAll.map(r => {
    const virs         = virByResa[r.id] || []
    const pmts         = pmtByResa[r.id] || []
    const virProuve    = virs.find(v => v.mouvement?.date_operation && v.mouvement.date_operation <= dateCloture)
    const pmtProuves   = pmts.filter(p => p.date_paiement && p.date_paiement <= dateCloture)
    const pmtSomme     = pmtProuves.reduce((s, p) => s + (p.montant || 0), 0)
    const hasPmtProuve = pmtProuves.length > 0
    const bienId       = r.bien?.id

    let statut, montant, dateEnc = null

    if (r.platform === 'airbnb' || r.platform === 'booking') {
      montant = r.fin_revenue || 0
      if (virProuve) {
        dateEnc = virProuve.mouvement.date_operation
        statut  = percevait(bienId, dateEnc) === false ? 'exclu_perimetre' : 'certain'
      } else if (r.platform === 'booking') {
        const bd = r.booking_date ? r.booking_date.slice(0, 10) : null
        if (bd && bd > dateCloture) {
          statut = 'exclu_post_cloture'; montant = r.fin_revenue || 0
        } else {
          const bpl = bplByCode[r.code]
          if (bpl) { statut = 'booking_prevu'; dateEnc = bpl.payout_date; montant = bpl.amount_cents || montant }
          else statut = 'absent'
        }
      } else {
        statut = 'exclu'
      }
    } else if (r.platform === 'manual') {
      if (hasPmtProuve) {
        statut  = 'certain_manuel'; montant = pmtSomme
        dateEnc = [...pmtProuves].sort((a, b) => (b.date_paiement||'').localeCompare(a.date_paiement||''))[0]?.date_paiement
      } else {
        const bd = r.booking_date ? r.booking_date.slice(0, 10) : null
        statut  = bd && bd <= dateCloture ? 'a_verifier_acompte' : 'exclu_post_cloture'
        montant = r.fin_revenue || 0
      }
    } else {
      // direct, stripe
      if (hasPmtProuve) {
        statut  = 'certain'; montant = pmtSomme
        dateEnc = [...pmtProuves].sort((a, b) => (b.date_paiement||'').localeCompare(a.date_paiement||''))[0]?.date_paiement
      } else {
        const bd      = r.booking_date ? r.booking_date.slice(0, 10) : null
        const splAvant = splByCode[r.code]?.avant
        statut  = (bd && bd <= dateCloture) || (!bd && splAvant) ? 'a_verifier_acompte' : 'exclu_post_cloture'
        montant = r.fin_revenue || 0
      }
    }

    const dateCharge = r.booking_date ? r.booking_date.slice(0, 10) : (splByCode[r.code]?.minDate ?? null)
    return { ...r, statut, montant, dateEnc, dateCharge }
  }).filter(l => l.statut !== 'exclu_post_cloture' && l.statut !== 'absent' && l.statut !== 'exclu')

  // 9. Génération CSV
  const sep = ';'
  const headers = ['Bien', 'Code résa', 'Date résa', 'Canal', 'Voyageur', 'Arrivée', 'Départ', 'Date enc.', 'Montant (€)', 'Statut']
  lignes.sort((a, b) => (a.bien?.code || '').localeCompare(b.bien?.code || '', 'fr'))

  const rows = lignes.map(l => [
    l.bien?.code || '',
    l.code || '',
    fmt(l.dateCharge),
    CANAL_LABEL[l.platform] || l.platform || '',
    l.guest_name || '',
    fmt(l.arrival_date),
    fmt(l.departure_date),
    fmt(l.dateEnc),
    fmtEuros(l.montant),
    STATUT_LABEL[l.statut] || l.statut,
  ])

  // Totaux
  const totalCertain   = lignes.filter(l => l.statut === 'certain' || l.statut === 'certain_manuel').reduce((s, l) => s + l.montant, 0)
  const totalAVerifier = lignes.filter(l => l.statut === 'booking_prevu' || l.statut === 'a_verifier_acompte').reduce((s, l) => s + l.montant, 0)

  const totalHorsPerimetre = lignes.filter(l => l.statut === 'exclu_perimetre').reduce((s, l) => s + l.montant, 0)
  const nbCertain   = lignes.filter(l => l.statut === 'certain' || l.statut === 'certain_manuel').length
  const nbAttente   = lignes.filter(l => l.statut === 'booking_prevu' || l.statut === 'a_verifier_acompte').length

  const escCol = v => `"${String(v).replace(/"/g, '""')}"`
  const E = (v, bold) => escCol(v)  // alias
  const lines = [
    `"SÉQUESTRE CLÔTURE ${annee}"${sep}"Généré le ${new Date().toLocaleDateString('fr-FR')}"${sep.repeat(8)}`,
    sep.repeat(9),
    `"RÉCAPITULATIF"${sep.repeat(7)}"MONTANT"${sep}`,
    `"Séquestre certain (prouvé en banque)"${sep.repeat(5)}${sep}"${nbCertain} résa${nbCertain > 1 ? 's' : ''}"${sep}"${fmtEuros(totalCertain)}"${sep}`,
    `"En attente de paiement (Booking / acompte)"${sep.repeat(5)}${sep}"${nbAttente} résa${nbAttente > 1 ? 's' : ''}"${sep}"${fmtEuros(totalAVerifier)}"${sep}`,
    ...(totalHorsPerimetre > 0 ? [`"Hors périmètre (informatif)"${sep.repeat(5)}${sep}${sep}"${fmtEuros(totalHorsPerimetre)}"${sep}`] : []),
    `"TOTAL"${sep.repeat(6)}${sep}"${lignes.length} résa${lignes.length > 1 ? 's' : ''}"${sep}"${fmtEuros(totalCertain + totalAVerifier)}"${sep}`,
    sep.repeat(9),
    '',
    headers.map(escCol).join(sep),
    ...rows.map(r => r.map(escCol).join(sep)),
  ]

  return '\uFEFF' + lines.join('\n')
}
