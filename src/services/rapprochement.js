/**
 * Service de rapprochement bancaire DCB — Flux 1 pur
 *
 * OBJECTIF : associer les virements ENTRANTS reçus par l'agence (mouvement_bancaire.credit)
 * aux réservations correspondantes. Ce flux vérifie que l'agence a bien été payée.
 *
 * Ce service NE concerne PAS le reversement propriétaire (VIR ventilation = Flux 2).
 *
 * Stratégie :
 *   mouvement_bancaire.credit ↔ payout_hospitable.amount (±2 centimes)
 *   → lie le mouvement au payout (mouvement_bancaire.statut = rapproche)
 *   → marque reservation.rapprochee = true
 *   → crée reservation_paiement (traçabilité)
 *   → NE touche JAMAIS ventilation.mouvement_id ni les lignes VIR
 *
 * NOTE sur le nommage hérité :
 *   Les fonctions et variables contenant "VIR" (getVirNonRapproches, virIds…)
 *   sont des vestiges de l'ancien modèle qui liait mouvement_bancaire ↔ ventilation.VIR.
 *   Ce modèle a été abandonné. Aujourd'hui, les lignes VIR ventilation servent uniquement
 *   de PROXY pour identifier la réservation (reservation_id) — elles ne sont jamais modifiées
 *   par le rapprochement. La cible réelle est reservation.rapprochee + reservation_paiement.
 *
 * Matching manuel (SEPA/Direct) :
 *   L'utilisateur sélectionne des réservations (affichées via leurs lignes VIR proxy)
 *   à associer au paiement reçu.
 */
import { supabase } from '../lib/supabase.js'
import { logOp } from './journal.js'
import { AGENCE } from '../lib/agence.js'

// ── LECTURE ────────────────────────────────────────────────────

export async function getMouvementsMois(mois) {
  const { data, error } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
    .eq('agence', AGENCE)
    .order('date_operation', { ascending: true })
  if (error) throw error
  const mouvements = data || []

  // Enrichir les mouvements rapprochés
  const rapproches = mouvements.filter(m => m.statut_matching === 'rapproche')
  const infoByMouv = {}

  // Passe 0 : reservation_paiement — multi-virements manuels (accomptes, soldes)
  if (rapproches.length > 0) {
    const mvtIds = rapproches.map(m => m.id)
    const { data: paiements } = await supabase
      .from('reservation_paiement')
      .select(`mouvement_id, type_paiement, montant,
        reservation (id, code, platform, guest_name, arrival_date, departure_date, nights, fin_revenue,
          bien (hospitable_name, agence, gestion_loyer))`)
      .in('mouvement_id', mvtIds)
    if (paiements?.length) {
      for (const p of paiements) {
        if (!p.mouvement_id || !p.reservation) continue
        const r = p.reservation
        if (!infoByMouv[p.mouvement_id]) {
          infoByMouv[p.mouvement_id] = {
            biens: [], guests: [], reservation_ids: [], codes: [],
            platform: r.platform, arrival_date: r.arrival_date,
            departure_date: r.departure_date, nights: r.nights || 0,
            fin_revenue: 0, nb_resas: 0, type_paiement: p.type_paiement
          }
        }
        const info = infoByMouv[p.mouvement_id]
        const bien = r.bien?.hospitable_name
        if (bien && !info.biens.includes(bien)) info.biens.push(bien)
        if (r.guest_name && !info.guests.includes(r.guest_name)) info.guests.push(r.guest_name)
        const isNewResa = !info.reservation_ids.includes(r.id)
        if (isNewResa) info.reservation_ids.push(r.id)
        if (!info.codes.includes(r.code)) info.codes.push(r.code)
        // fin_revenue et nights : additionner UNE SEULE fois par résa (dédup)
        if (isNewResa) info.nb_resas++
        if (isNewResa) info.fin_revenue += (r.fin_revenue || 0)
        if (isNewResa) info.nights = (info.nights || 0) + (r.nights || 0)
        if (isNewResa && r.arrival_date && (!info.arrival_date || r.arrival_date < info.arrival_date)) info.arrival_date = r.arrival_date
        if (isNewResa && r.departure_date && (!info.departure_date || r.departure_date > info.departure_date)) info.departure_date = r.departure_date
      }
      // Normaliser + marquer comme enrichi par passe 0
      for (const info of Object.values(infoByMouv)) {
        info.bien_name  = info.biens.join(' | ')
        info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
        info._fromPasse0 = true  // empêche la passe 1 de réécrire
      }
      // Attacher aux mouvements
      for (const m of rapproches) {
        if (infoByMouv[m.id]) m._resa = infoByMouv[m.id]
      }
    }
  }

  if (rapproches.length > 0) {
    const ids = rapproches.map(m => m.id)
    // Charger les VIR liés par batch de 100
    const BATCH = 100
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      const { data: virs } = await supabase
        .from('ventilation')
        .select(`mouvement_id, reservation (id, code, guest_name, arrival_date, departure_date, nights, platform, fin_revenue, bien (hospitable_name, gestion_loyer, agence))`)
        .eq('code', 'VIR')
        .in('mouvement_id', chunk)
      if (virs) {
        for (const v of virs) {
          if (!v.mouvement_id || !v.reservation) continue
          if (infoByMouv[v.mouvement_id]?._fromPasse0) continue  // déjà enrichi via reservation_paiement
          if (!infoByMouv[v.mouvement_id]) {
            infoByMouv[v.mouvement_id] = { biens: [], guests: [], reservation_ids: [], codes: [], platform: v.reservation.platform, gestion_loyer: v.reservation.bien?.gestion_loyer, agence: v.reservation.bien?.agence, arrival_date: v.reservation.arrival_date, departure_date: v.reservation.departure_date, nights: v.reservation.nights, fin_revenue: 0, nb_resas: 0 }
          }
          const _info = infoByMouv[v.mouvement_id]
          const _bien = v.reservation.bien?.hospitable_name
          if (_bien && !_info.biens.includes(_bien)) _info.biens.push(_bien)
          if (v.reservation.guest_name && !_info.guests.includes(v.reservation.guest_name)) _info.guests.push(v.reservation.guest_name)
          _info.fin_revenue += (v.reservation.fin_revenue || 0)
          _info.nb_resas++
          if (v.reservation.id && !_info.reservation_ids.includes(v.reservation.id)) _info.reservation_ids.push(v.reservation.id)
          if (v.reservation.code && !_info.codes.includes(v.reservation.code)) _info.codes.push(v.reservation.code)
          // Mettre à jour departure_date et nights si plusieurs resas
          if (v.reservation.departure_date && (!_info.departure_date || v.reservation.departure_date > _info.departure_date)) _info.departure_date = v.reservation.departure_date
          if (v.reservation.nights) _info.nights = (_info.nights || 0) + v.reservation.nights
        }
      }
    }

    // Normaliser : bien_name et guest_name agrégés
    for (const info of Object.values(infoByMouv)) {
      info.bien_name = info.biens.join(' · ')
      info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
    }

    for (const m of rapproches) {
      m._resa = infoByMouv[m.id] || null
    }

    // Passe 2 : payout_hospitable → payout_reservation → reservation
    // Couvre les virements Airbnb rapprochés via payout mais sans VIR lié ni reservation_paiement
    const sansResaPasse2 = rapproches.filter(m => !m._resa)
    if (sansResaPasse2.length > 0) {
      const mvtIds2 = sansResaPasse2.map(m => m.id)
      const { data: payouts2 } = await supabase
        .from('payout_hospitable')
        .select(`mouvement_id,
          payout_reservation (
            reservation (id, code, platform, guest_name, arrival_date, departure_date, nights, fin_revenue,
              bien (hospitable_name, code, agence))
          )`)
        .in('mouvement_id', mvtIds2)
      if (payouts2?.length) {
        const infoByMouv2 = {}
        for (const ph of payouts2) {
          if (!ph.mouvement_id) continue
          for (const pr of (ph.payout_reservation || [])) {
            const r = pr.reservation
            if (!r) continue
            if (!infoByMouv2[ph.mouvement_id]) {
              infoByMouv2[ph.mouvement_id] = {
                biens: [], guests: [], reservation_ids: [], codes: [],
                platform: r.platform, arrival_date: r.arrival_date,
                departure_date: r.departure_date, nights: 0, fin_revenue: 0, nb_resas: 0
              }
            }
            const info = infoByMouv2[ph.mouvement_id]
            const bien = r.bien?.hospitable_name
            if (bien && !info.biens.includes(bien)) info.biens.push(bien)
            if (r.guest_name && !info.guests.includes(r.guest_name)) info.guests.push(r.guest_name)
            if (!info.reservation_ids.includes(r.id)) {
              info.reservation_ids.push(r.id)
              info.codes.push(r.code)
              info.fin_revenue += (r.fin_revenue || 0)
              info.nights += (r.nights || 0)
              if (!info.arrival_date || r.arrival_date < info.arrival_date) info.arrival_date = r.arrival_date
              if (!info.departure_date || r.departure_date > info.departure_date) info.departure_date = r.departure_date
              info.nb_resas++
            }
          }
        }
        for (const m of sansResaPasse2) {
          const info = infoByMouv2[m.id]
          if (info) {
            info.bien_name = info.biens.join(' | ')
            info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
            m._resa = info
          }
        }
      }
    }

  // Enrichissement secondaire Airbnb : groupement par airbnb_account depuis les resas
  // Airbnb ne donne pas l'info du compte — on teste chaque compte
  // et on n'affecte que si UN SEUL compte donne une combinaison exacte
  const nonEnriches = rapproches.filter(m => !m._resa && m.canal === 'airbnb')
  if (nonEnriches.length > 0) {
    const { data: resasByMois } = await supabase
      .from('reservation')
      .select('id, code, guest_name, arrival_date, departure_date, fin_revenue, bien(hospitable_name, agence, airbnb_account)')
      .eq('mois_comptable', mois)
      .eq('platform', 'airbnb')
      .gt('fin_revenue', 0)
    const parCompte = {}
    for (const r of (resasByMois || [])) {
      const cpt = r.bien?.airbnb_account || '__inconnu__'
      if (!parCompte[cpt]) parCompte[cpt] = []
      parCompte[cpt].push(r)
    }
    const usedResaIds = new Set()
    for (const mvt of nonEnriches) {
      const matches = []
      for (const [cpt, resas] of Object.entries(parCompte)) {
        const cands = resas.filter(r => !usedResaIds.has(r.id))
        if (!cands.length) continue
        const exact = cands.find(r => Math.abs((r.fin_revenue || 0) - mvt.credit) <= 2)
        if (exact) { matches.push({ cpt, resas: [exact] }); continue }
        const sorted = [...cands].sort((a,b) => b.fin_revenue - a.fin_revenue).slice(0, 10)
        for (let t = 2; t <= 4; t++) {
          let rem = mvt.credit, sel = []
          for (const r of sorted) {
            if (r.fin_revenue <= rem + 2 && sel.length < t) { sel.push(r); rem -= r.fin_revenue }
            if (Math.abs(rem) <= 2 && sel.length === t) break
          }
          if (sel.length === t && Math.abs(rem) <= 2) { matches.push({ cpt, resas: sel }); break }
        }
      }
      if (matches.length === 1) {
        const { resas } = matches[0]
        resas.forEach(r => usedResaIds.add(r.id))
        if (resas.length === 1) {
          const r = resas[0]
          mvt._resa = { guest_name: r.guest_name, bien_name: r.bien?.hospitable_name, arrival_date: r.arrival_date, departure_date: r.departure_date, platform: 'airbnb', fin_revenue: r.fin_revenue, agence: r.bien?.agence, biens: [r.bien?.hospitable_name].filter(Boolean), guests: [r.guest_name].filter(Boolean), reservation_ids: [r.id], codes: [r.code], nb_resas: 1 }
        } else {
          mvt._resa = { guest_name: resas.length + ' voyageur(s)', bien_name: [...new Set(resas.map(r => r.bien?.hospitable_name).filter(Boolean))].join(' | '), platform: 'airbnb', fin_revenue: resas.reduce((s,r) => s+r.fin_revenue, 0), nb_resas: resas.length, biens: [...new Set(resas.map(r => r.bien?.hospitable_name).filter(Boolean))], guests: resas.map(r => r.guest_name).filter(Boolean), reservation_ids: resas.map(r => r.id), codes: resas.map(r => r.code) }
        }
      }
    }
  }
}
  // Enrichissement tertiaire : Stripe via stripe_payout_line, Booking via booking_payout_line
  const encoreVides = mouvements.filter(m =>
    (m.statut_matching === 'rapproche' || m.statut_matching === 'matche_auto' || m.statut_matching === 'matche_manuel') && !m._resa
  )
  if (encoreVides.length > 0) {
    const mvtIds = encoreVides.map(m => m.id)
    const stripeIds  = encoreVides.filter(m => m.canal === 'stripe').map(m => m.id)
    const bookingIds = encoreVides.filter(m => m.canal === 'booking').map(m => m.id)
    const airbnbIds  = encoreVides.filter(m => m.canal === 'airbnb').map(m => m.id)

    // ── Stripe : stripe_payout_line → reservation via reservation_code ──────
    if (stripeIds.length > 0) {
      const { data: stripeLines } = await supabase
        .from('stripe_payout_line')
        .select('mouvement_id, reservation_code, guest_name, montant_net, description, type_ligne')
        .in('mouvement_id', stripeIds)

      if (stripeLines?.length > 0) {
        // Charger les r?servations correspondantes
        const codes = [...new Set(stripeLines.map(l => l.reservation_code).filter(Boolean))]
        const { data: resas } = await supabase
          .from('reservation')
          .select('id, code, platform, guest_name, arrival_date, departure_date, nights, fin_revenue, bien(hospitable_name, agence, gestion_loyer)')
          .in('code', codes)

        const resaByCode = Object.fromEntries((resas || []).map(r => [r.code, r]))

        const infoStripe = {}
        for (const line of stripeLines) {
          const mvtId = line.mouvement_id
          if (!infoStripe[mvtId]) infoStripe[mvtId] = { biens: [], guests: [], reservation_ids: [], codes: [], platform: 'direct', arrival_date: null, departure_date: null, nights: 0, fin_revenue: 0, nb_resas: 0 }
          const info = infoStripe[mvtId]

          // Toutes les lignes contribuent au total (frais Stripe sont négatifs)
          info.fin_revenue += (line.montant_net || 0)

          // Seules les lignes réservation enrichissent le détail
          if (line.type_ligne !== 'reservation') continue

          const resa = resaByCode[line.reservation_code]
          if (resa) {
            const bien = resa.bien?.hospitable_name
            if (bien && !info.biens.includes(bien)) info.biens.push(bien)
            if (resa.guest_name && !info.guests.includes(resa.guest_name)) info.guests.push(resa.guest_name)
            const isNewResa = !info.reservation_ids.includes(resa.id)
            if (isNewResa) info.reservation_ids.push(resa.id)
            if (!info.codes.includes(resa.code)) info.codes.push(resa.code)
            if (isNewResa) info.nights += (resa.nights || 0)
            if (isNewResa) info.nb_resas++
            if (!info.arrival_date || resa.arrival_date < info.arrival_date) info.arrival_date = resa.arrival_date
            if (!info.departure_date || resa.departure_date > info.departure_date) info.departure_date = resa.departure_date
          } else if (line.guest_name && !info.guests.includes(line.guest_name)) {
            info.guests.push(line.guest_name)
          }
          if (line.reservation_code && !info.codes.includes(line.reservation_code)) info.codes.push(line.reservation_code)
        }
        for (const m of encoreVides.filter(m => m.canal === 'stripe')) {
          if (infoStripe[m.id]) {
            const info = infoStripe[m.id]
            info.bien_name  = info.biens.join(' | ')
            info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
            m._resa = info
            // Alimenter reservation_paiement (automatique pour les prochains virements)
            const mvtObj = m
            for (const resaId of info.reservation_ids) {
              const line = stripeLines?.find(l => resaByCode[l.reservation_code]?.id === resaId)
              const montant = line ? line.montant_net : mvtObj.credit
              const finRev = stripeLines ? (resaByCode[line?.reservation_code]?.fin_revenue || 0) : 0
              supabase.from('reservation_paiement').upsert({
                reservation_id: resaId, mouvement_id: m.id,
                montant, date_paiement: mvtObj.date_operation,
                description_paiement: line?.description || null,
                type_paiement: (finRev && montant >= finRev * 0.99) ? 'total' : 'acompte'
              }, { onConflict: 'reservation_id,mouvement_id', ignoreDuplicates: false }).then(() => {})
            }
            if (info.reservation_ids.length) {
              supabase.from('reservation').update({ rapprochee: true }).in('id', info.reservation_ids).then(() => {})
            }
          }
        }
      }
    }

    // ── Booking : booking_payout_line → reservation via booking_ref ──────────
    if (bookingIds.length > 0) {
      const { data: bookingLines } = await supabase
        .from('booking_payout_line')
        .select('mouvement_id, booking_ref, guest_name, checkin, checkout, property_name, amount_cents, gross_cents')
        .in('mouvement_id', bookingIds)
        .not('booking_ref', 'is', null)

      if (bookingLines?.length > 0) {
        // Chercher les r?servations Booking par platform_id (booking_ref)
        const refs = [...new Set(bookingLines.map(l => l.booking_ref).filter(Boolean))]
        const { data: resas } = await supabase
          .from('reservation')
          .select('id, code, platform, platform_id, guest_name, arrival_date, departure_date, nights, fin_revenue, bien(hospitable_name, agence, gestion_loyer)')
          .eq('platform', 'booking')
          .in('platform_id', refs)

        const resaByRef = Object.fromEntries((resas || []).map(r => [r.platform_id, r]))

        const infoBooking = {}
        for (const line of bookingLines) {
          const mvtId = line.mouvement_id
          if (!infoBooking[mvtId]) infoBooking[mvtId] = { biens: [], guests: [], reservation_ids: [], codes: [], platform: 'booking', arrival_date: null, departure_date: null, nights: 0, fin_revenue: 0, nb_resas: 0 }
          const info = infoBooking[mvtId]
          const resa = resaByRef[line.booking_ref]
          if (resa) {
            const bien = resa.bien?.hospitable_name
            if (bien && !info.biens.includes(bien)) info.biens.push(bien)
            if (resa.guest_name && !info.guests.includes(resa.guest_name)) info.guests.push(resa.guest_name)
            if (!info.reservation_ids.includes(resa.id)) info.reservation_ids.push(resa.id)
            if (!info.codes.includes(resa.code)) info.codes.push(resa.code)
            // amount_cents = montant réel Booking pour cette résa (inclut taxe de séjour)
            // Fallback sur fin_revenue si amount_cents absent
            info.fin_revenue += (line.amount_cents ?? resa.fin_revenue ?? 0)
            info.nights += (resa.nights || 0)
            info.nb_resas++
          } else {
            // Fallback : utiliser les infos directement de booking_payout_line
            if (line.property_name && !info.biens.includes(line.property_name)) info.biens.push(line.property_name)
            if (line.checkin && (!info.arrival_date || line.checkin < info.arrival_date)) info.arrival_date = line.checkin
            if (line.checkout && (!info.departure_date || line.checkout > info.departure_date)) info.departure_date = line.checkout
          }
          if (line.booking_ref && !info.codes.includes(line.booking_ref)) info.codes.push(line.booking_ref)
        }
        for (const m of encoreVides.filter(m => m.canal === 'booking')) {
          if (infoBooking[m.id]) {
            const info = infoBooking[m.id]
            info.bien_name  = info.biens.join(' | ')
            info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
            m._resa = info
            // Alimenter reservation_paiement + marquer rapprochee
            for (const resaId of info.reservation_ids) {
              const bRef = Object.keys(resaByRef).find(k => resaByRef[k]?.id === resaId)
              const line = bookingLines?.find(l => l.booking_ref === bRef)
              const montant = line ? line.amount_cents : m.credit  // amount_cents = centimes (cohérent avec fin_revenue)
              const finRev = resaByRef[bRef]?.fin_revenue || 0
              supabase.from('reservation_paiement').upsert({
                reservation_id: resaId, mouvement_id: m.id,
                montant, date_paiement: m.date_operation,
                type_paiement: (finRev && montant >= finRev * 0.99) ? 'total' : 'acompte'
              }, { onConflict: 'reservation_id,mouvement_id', ignoreDuplicates: true }).then(() => {})
            }
            if (info.reservation_ids.length) {
              supabase.from('reservation').update({ rapprochee: true }).in('id', info.reservation_ids).then(() => {})
            }
          }
        }
      }
    }

    // ── Airbnb CSV : airbnb_payout_line → reservation via confirmation_code ──
    if (airbnbIds.length > 0) {
      const { data: airbnbLines } = await supabase
        .from('airbnb_payout_line')
        .select('mouvement_id, confirmation_code, guest_name, checkin, checkout, property_name, amount_cents')
        .in('mouvement_id', airbnbIds)
        .not('confirmation_code', 'is', null)

      if (airbnbLines?.length > 0) {
        const codes = [...new Set(airbnbLines.map(l => l.confirmation_code).filter(Boolean))]
        const { data: resas } = await supabase
          .from('reservation')
          .select('id, code, platform, guest_name, arrival_date, departure_date, nights, fin_revenue, bien(hospitable_name, agence, gestion_loyer)')
          .eq('platform', 'airbnb')
          .in('code', codes)

        const resaByCode = Object.fromEntries((resas || []).map(r => [r.code, r]))

        const infoAirbnb = {}
        for (const line of airbnbLines) {
          const mvtId = line.mouvement_id
          if (!infoAirbnb[mvtId]) infoAirbnb[mvtId] = { biens: [], guests: [], reservation_ids: [], codes: [], platform: 'airbnb', arrival_date: null, departure_date: null, nights: 0, fin_revenue: 0, nb_resas: 0 }
          const info = infoAirbnb[mvtId]
          const resa = resaByCode[line.confirmation_code]
          if (resa) {
            const bien = resa.bien?.hospitable_name
            if (bien && !info.biens.includes(bien)) info.biens.push(bien)
            if (resa.guest_name && !info.guests.includes(resa.guest_name)) info.guests.push(resa.guest_name)
            if (!info.reservation_ids.includes(resa.id)) info.reservation_ids.push(resa.id)
            if (!info.codes.includes(resa.code)) info.codes.push(resa.code)
            info.fin_revenue += (line.amount_cents ?? resa.fin_revenue ?? 0)
            info.nights += (resa.nights || 0)
            info.nb_resas++
            if (!info.arrival_date || resa.arrival_date < info.arrival_date) info.arrival_date = resa.arrival_date
            if (!info.departure_date || resa.departure_date > info.departure_date) info.departure_date = resa.departure_date
          } else {
            if (line.property_name && !info.biens.includes(line.property_name)) info.biens.push(line.property_name)
            if (line.checkin && (!info.arrival_date || line.checkin < info.arrival_date)) info.arrival_date = line.checkin
            if (line.checkout && (!info.departure_date || line.checkout > info.departure_date)) info.departure_date = line.checkout
          }
          if (line.confirmation_code && !info.codes.includes(line.confirmation_code)) info.codes.push(line.confirmation_code)
        }
        for (const m of encoreVides.filter(m => m.canal === 'airbnb')) {
          if (infoAirbnb[m.id]) {
            const info = infoAirbnb[m.id]
            info.bien_name  = info.biens.join(' | ')
            info.guest_name = info.guests.length === 1 ? info.guests[0] : (info.nb_resas + ' résa(s)')
            m._resa = info
            for (const resaId of info.reservation_ids) {
              const code = Object.keys(resaByCode).find(k => resaByCode[k]?.id === resaId)
              const line = airbnbLines?.find(l => l.confirmation_code === code)
              const montant = line?.amount_cents ?? m.credit
              const finRev = resaByCode[code]?.fin_revenue || 0
              supabase.from('reservation_paiement').upsert({
                reservation_id: resaId, mouvement_id: m.id,
                montant, date_paiement: m.date_operation,
                type_paiement: (finRev && montant >= finRev * 0.99) ? 'total' : 'acompte'
              }, { onConflict: 'reservation_id,mouvement_id', ignoreDuplicates: true }).then(() => {})
            }
            if (info.reservation_ids.length) {
              supabase.from('reservation').update({ rapprochee: true }).in('id', info.reservation_ids).then(() => {})
            }
          }
        }
      }
    }
  }

  // Marquer les d  // Marquer les débits seuls comme debit_en_attente
  for (const m of mouvements) {
    if (m.statut_matching === 'en_attente' && !(m.credit > 0) && m.debit > 0) {
      m.statut_matching = 'debit_en_attente'
    }
  }

  return mouvements
}

/**
 * Propage un rapprochement payout CSV → niveau réservation.
 *
 * Appelé par importBooking/importAirbnb dès qu'un payout CSV est lié à un mouvement
 * bancaire : upsert reservation_paiement + reservation.rapprochee (si paiement complet ≥96%,
 * même règle que _lierViaPayout). Sans cette propagation immédiate, la résa restait
 * « sans virement » dans son mois comptable tant que la page Rapprochement du mois du
 * MOUVEMENT n'avait pas été ouverte (passe d'enrichissement de getMouvementsMois) —
 * fausse alerte alors que le contrôle trésorerie (reservation_mouvement) voyait, lui,
 * l'argent arrivé. Cas Sinnika/MIRAMARVEL 2026-06, corrigé le 03/07/2026.
 *
 * @param mouv   mouvement bancaire { id, date_operation }
 * @param platform 'booking' (match reservation.platform_id) ou 'airbnb' (match reservation.code)
 * @param lignes [{ ref, amount_cents }] — une entrée par ligne payout CSV
 * @returns nombre de réservations marquées rapprochées
 */
export async function propagerRapprochementResas(mouv, platform, lignes) {
  const refs = [...new Set(lignes.map(l => l.ref).filter(Boolean))]
  if (!refs.length) return 0
  const col = platform === 'booking' ? 'platform_id' : 'code'
  const { data: resas } = await supabase
    .from('reservation')
    .select(`id, ${col}, fin_revenue, rapprochee`)
    .eq('platform', platform)
    .in(col, refs)
  let n = 0
  for (const r of (resas || [])) {
    const line = lignes.find(l => l.ref === r[col])
    const montant = line?.amount_cents ?? 0
    await supabase.from('reservation_paiement').upsert({
      reservation_id: r.id, mouvement_id: mouv.id, montant,
      date_paiement: mouv.date_operation,
      type_paiement: (r.fin_revenue && montant >= r.fin_revenue * 0.99) ? 'total' : 'acompte',
    }, { onConflict: 'reservation_id,mouvement_id', ignoreDuplicates: true })
    if (r.rapprochee) continue
    // rapprochee=true uniquement si paiement complet — si acompte/partiel, laisser false
    const { data: allP } = await supabase.from('reservation_paiement').select('montant').eq('reservation_id', r.id)
    const totalRecu = (allP || []).reduce((s, p) => s + (p.montant || 0), 0)
    if (!r.fin_revenue || totalRecu >= r.fin_revenue * 0.96) {
      await supabase.from('reservation').update({ rapprochee: true }).eq('id', r.id)
      n++
    }
  }
  return n
}

/**
 * Charge les réservations en attente de PAYIN (paiement entrant non encore rapproché).
 *
 * Requête directe sur `reservation` — plus de proxy ventilation VIR.
 * Source de vérité : reservation.rapprochee + reservation.fin_revenue (= host.revenue Hospitable,
 * disponible pour tous les canaux : Airbnb, Booking, Direct, Manual).
 *
 * Fenêtre glissante : -2 mois → +7 mois depuis aujourd'hui (couvre acomptes + arriérés).
 * Note : le paramètre `mois` est ignoré — la fenêtre est toujours calculée depuis new Date().
 */
export async function getResasEnAttentePayin(mois) {
  const now = new Date()
  const dateMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 7)
  const dateMax = new Date(now.getFullYear(), now.getMonth() + 7, 1).toISOString().slice(0, 7)
  const { data, error } = await supabase
    .from('reservation')
    .select(`
      id, code, platform, guest_name, arrival_date, departure_date, nights,
      fin_revenue, final_status, rapprochee, mois_comptable,
      bien!inner (id, code, hospitable_name, gestion_loyer, agence),
      ventilation (montant_ttc, code),
      reservation_paiement (montant)
    `)
    .neq('rapprochee', true)
    .gte('mois_comptable', dateMin)
    .lte('mois_comptable', dateMax)
    .eq('bien.agence', AGENCE)
    .gt('fin_revenue', 0)
    .order('mois_comptable', { ascending: false })
  if (error) throw error
  return (data || []).filter(r => {
    if (r.bien?.agence !== AGENCE) return false
    if (r.final_status === 'not accepted') return false
    if (r.final_status === 'cancelled') return false
    // Biens sans gestion loyer : l'OTA paye directement le proprio → on n'attend aucun PAYIN Airbnb/Booking
    // Resas manual/direct/stripe : toujours afficher (l'agence encaisse)
    if (!r.bien?.gestion_loyer && ['airbnb', 'booking'].includes(r.platform)) return false
    return true
  })
}

export async function getStatsRapprochement(mois) {
  const [{ data: m }, { data: r }] = await Promise.all([
    supabase.from('mouvement_bancaire').select('statut_matching,credit,debit,canal').eq('mois_releve', mois).eq('agence', AGENCE),
    // bien!inner(agence) : sans ce filtre la tuile « Résas payin reçu » mélangeait les
    // résas des deux agences (ex. 93/141 affiché côté DCB au lieu de 78/125)
    supabase.from('reservation').select('rapprochee,final_status,bien!inner(agence)').eq('mois_comptable', mois)
      .eq('bien.agence', AGENCE)
      .not('final_status', 'in', '("not accepted","cancelled")').gt('fin_revenue', 0),
  ])
  const mouvements = m || [], resas = r || []
  return {
    total_mouvements: mouvements.length,
    rapproches: mouvements.filter(x => x.statut_matching === 'rapproche').length,
    en_attente: mouvements.filter(x => x.statut_matching === 'en_attente' && (x.credit || 0) > 0).length,
    non_identifie: mouvements.filter(x => x.statut_matching === 'non_identifie').length,
    total_entrees: mouvements.filter(x => x.credit > 0).reduce((s, x) => s + (x.credit || 0), 0),
    total_sorties: mouvements.filter(x => x.debit > 0).reduce((s, x) => s + (x.debit || 0), 0),
    resas_total: resas.length,
    resas_rapprochees: resas.filter(x => x.rapprochee).length,
  }
}

// ── MATCHING AUTO ──────────────────────────────────────────────

export async function lancerMatchingAuto(mois, source = 'manuel') {
  const log = { matched: 0, skipped: 0, errors: 0, details: [] }

  try {
    // Mouvements du mois en attente avec entrée (credit > 0)
    const mouvements = await getMouvementsMois(mois)
    const libres = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit || 0) > 0)

    // ── Promotion Booking depuis booking_payout_line ─────────────────
    // Le rapprochement Booking vit dans booking_payout_line (CSV extranet Booking),
    // PAS dans payout_hospitable (vide pour Booking). Un mouvement Booking reste à tort
    // 'en_attente' quand : (a) il est déjà lié mais la promotion a été perdue (désync
    // après un annuler/reset), ou (b) le CSV Booking a été importé avant le relevé
    // (lignes orphelines mouvement_id=NULL). On promeut ici en 'rapproche' AVANT la passe
    // d'enrichissement, qui ne traite que les mouvements déjà rapprochés.
    await _promouvoirBookingLignes(libres, log)

    // Charger TOUS les payouts sans mouvement (pas de filtre par date)
    // Les payouts Hospitable peuvent dater de n importe quand
    // On pagine par 1000 pour tout récupérer
    let payoutsAll = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data: page } = await supabase
        .from('payout_hospitable')
        .select('id, hospitable_id, amount, platform, date_payout, mouvement_id, reference, platform_id')
        .is('mouvement_id', null)
        .range(from, from + PAGE - 1)
      if (!page || page.length === 0) break
      payoutsAll.push(...page)
      if (page.length < PAGE) break
      from += PAGE
    }

    // Filtre agence : les payouts synthétiques Airbnb embarquent l'id de résa dans hospitable_id.
    // Sans ce filtre, les payouts de l'AUTRE agence polluent les candidats du subset-sum
    // (bruit haute saison) et un virement DCB pourrait être « expliqué » par des payouts Lauian.
    const synthResaIds = payoutsAll
      .filter(p => p.hospitable_id?.endsWith('_airbnb_payout'))
      .map(p => p.hospitable_id.replace('_airbnb_payout', ''))
    const agenceByResa = {}
    for (let i = 0; i < synthResaIds.length; i += 300) {
      const { data: rs } = await supabase
        .from('reservation')
        .select('id, bien!inner(agence)')
        .in('id', synthResaIds.slice(i, i + 300))
      for (const r of (rs || [])) agenceByResa[r.id] = r.bien?.agence
    }
    payoutsAll = payoutsAll.filter(p => {
      if (!p.hospitable_id?.endsWith('_airbnb_payout')) return true
      const ag = agenceByResa[p.hospitable_id.replace('_airbnb_payout', '')]
      return !ag || ag === AGENCE
    })

    // ── AIRBNB + BOOKING ───────────────────────────────────────────
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)
      // Pour Airbnb : payouts synthétiques (fin_revenue → lien resa garanti) + payouts RÉELS
        // créés par le Sync Airbnb (reference non-null : résolutions/recouches, ajustements,
        // payouts fractionnés) — leur montant = total bancaire, match exact garanti.
        // Pour Booking : payouts réels (ils ont payout_reservation via booking_payout_line)
        const payoutsCanal = payoutsAll.filter(p => {
          if (p.platform !== canal) return false
          if (canal === 'airbnb') return p.hospitable_id?.endsWith('_airbnb_payout') || p.reference != null
          return true
        })
      for (const mouv of mouvCanal) {

        // Etape 0 : référence payout dans le libellé/détail bancaire — Powens fournit
        // « G-XXXX…-Airbnb » = platform_id du payout → match SANS ambiguïté, même quand
        // deux payouts ont le même montant (faux match Maeva/Naiara du 03/07 : deux
        // payouts à 327,23 €, celui d'avril pris pour le virement de juin).
        const dateMvt1 = new Date(mouv.date_operation)
        const refPayout = ((mouv.libelle || '') + ' ' + (mouv.detail || '')).toUpperCase().match(/\b[GM]-[A-Z0-9]{15,}\b/)
        let payoutExact = refPayout ? payoutsCanal.find(p => p.platform_id === refPayout[0]) : null

        // Etape 1 : payout exact — fenetres de date croissantes J+0 a J+10 puis fallback
        if (!payoutExact) for (let j = 0; j <= 10; j++) {
          payoutExact = payoutsCanal.find(p =>
            Math.abs(p.amount - mouv.credit) <= 2 &&
            Math.abs((new Date(p.date_payout) - dateMvt1) / 86400000) <= j
          )
          if (payoutExact) break
        }
        if (!payoutExact) {
          // Fallback : montant unique parmi les payouts disponibles, borné à ±30 j
          // (sans borne, le payout d'avril de Naiara a « expliqué » le virement de juin de Maeva)
          const candidates = payoutsCanal.filter(p =>
            Math.abs(p.amount - mouv.credit) <= 2 &&
            Math.abs((new Date(p.date_payout) - dateMvt1) / 86400000) <= 30
          )
          if (candidates.length === 1) payoutExact = candidates[0]
        }

        if (payoutExact) {
          // Récupérer les resaIds EN PREMIER
          const { data: prLinks } = await supabase
            .from('payout_reservation')
            .select('reservation_id, amount_cents')
            .eq('payout_id', payoutExact.id)
          let resaIds = (prLinks || []).map(r => r.reservation_id).filter(Boolean)

          const isRealAirbnb = canal === 'airbnb' && !payoutExact.hospitable_id?.endsWith('_airbnb_payout')

          // Fallback : payout_reservation vide → chercher par fin_revenue exact + platform + mois
          // Contrainte triple pour éviter tout faux match (≠ ancien fallback VIR ±200)
          // (pas pour les payouts réels : une résolution/recouche n'a légitimement pas de résa)
          if (!resaIds.length && !isRealAirbnb) {
            const { data: resaFallback } = await supabase
              .from('reservation')
              .select('id')
              .eq('platform', canal)
              .eq('fin_revenue', payoutExact.amount)
              .eq('mois_comptable', mois)
            if (resaFallback?.length === 1) {
              resaIds = resaFallback.map(r => r.id)
              log.details.push({ type: canal + '_fallback_finrevenue', montant: mouv.credit / 100 })
            }
          }

          if (isRealAirbnb) {
            // Payout réel Airbnb (résolution/recouche, ajustement, fractionné) :
            // créditer chaque résa de SA part (amount_cents du payout, PAS le crédit bancaire
            // total qui peut inclure un ajustement négatif d'une autre résa)
            if (resaIds.length) {
              const { data: resasData } = await supabase
                .from('reservation').select('id, code').in('id', resaIds)
              const codeById = Object.fromEntries((resasData || []).map(r => [r.id, r.code]))
              const lignes = (prLinks || [])
                .map(l => ({ ref: codeById[l.reservation_id], amount_cents: l.amount_cents }))
                .filter(l => l.ref && l.amount_cents != null)
              if (lignes.length) {
                await propagerRapprochementResas(mouv, 'airbnb', lignes)
              } else {
                await _lierViaPayout(mouv.id, resaIds, mouv)
              }
              // Sortir du pool les lignes synthétiques jumelles (même argent sous forme par-résa)
              const twinIds = resaIds.map(id => id + '_airbnb_payout')
              await supabase.from('payout_hospitable')
                .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
                .in('hospitable_id', twinIds).is('mouvement_id', null)
              for (const tid of twinIds) {
                const tw = payoutsCanal.find(p => p.hospitable_id === tid)
                if (tw) payoutsCanal.splice(payoutsCanal.indexOf(tw), 1)
              }
            }
            // Lier le payout AVANT de marquer le mouvement — le trigger prevent_ghost_match
            // refuse un passage à 'rapproche' sans lien FK (pour une résolution sans résa,
            // payout_hospitable est le SEUL lien possible). Bug du 03/07 : les mouvements
            // 75/75/85 € restaient en_attente alors que leurs payouts étaient consommés.
            await supabase.from('payout_hospitable')
              .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
              .eq('id', payoutExact.id)
            // Payout de résolution sans lien résa : si la référence cite un code de résa
            // (« Resolution payout … - Reservation HMXXXX »), créditer cette résa — sinon
            // le contrôle trésorerie ne voit jamais ce cash (cas Shelly Kamiel, recouche 75 €)
            if (!resaIds.length && payoutExact.reference) {
              const codeRef = payoutExact.reference.toUpperCase().match(/\b(HM[A-Z0-9]{8,10})\b/)
              if (codeRef) {
                const { data: resaRef } = await supabase
                  .from('reservation').select('id, code, bien!inner(agence)')
                  .eq('code', codeRef[1]).eq('bien.agence', AGENCE).maybeSingle()
                if (resaRef) {
                  await propagerRapprochementResas(mouv, 'airbnb', [{ ref: resaRef.code, amount_cents: payoutExact.amount }])
                  resaIds = [resaRef.id]
                }
              }
            }
            // Marquer le mouvement (avec le détail de la résolution si pas de résa)
            const detailMaj = resaIds.length
              ? {}
              : { detail: ('Résolution Airbnb : ' + (payoutExact.reference || '')).slice(0, 500) }
            const { error: mvtUpdErr } = await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche', ...detailMaj })
              .eq('id', mouv.id)
            if (mvtUpdErr) {
              log.errors++
              log.details.push({ type: 'airbnb_reel_mvt_err', montant: mouv.credit / 100, message: mvtUpdErr.message })
              continue
            }
          } else {
            // _lierViaPayout crée reservation_paiement + met statut_matching AVANT payout_hospitable
            await _lierViaPayout(mouv.id, resaIds, mouv)
          }

          // Mettre à jour payout_hospitable APRÈS que reservation_paiement existe
          await supabase.from('payout_hospitable')
            .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
            .eq('id', payoutExact.id)

          payoutsCanal.splice(payoutsCanal.indexOf(payoutExact), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal + '_exact', montant: mouv.credit / 100, nb_resas: resaIds.length })
          continue
        }

        // Etape 2 : regroupement N payouts -> 1 mouvement (Airbnb groupe par compte)
        // Fenetres de date croissantes : +/-2j, +/-7j, +/-14j, tout
        const dateMvt2 = new Date(mouv.date_operation)
        const FENETRES_AIRBNB = [2, 7, 14, 999]
        let subsetPay = null
        for (const fenetre of FENETRES_AIRBNB) {
          // Les payouts réels (reference non-null) correspondent 1:1 à un virement bancaire :
          // ils ne participent pas aux regroupements (et feraient doublon avec leurs
          // jumeaux synthétiques par-résa dans les combinaisons)
          const poolGroupe = payoutsCanal.filter(p => !(canal === 'airbnb' && p.reference != null))
          const paysFiltres = fenetre >= 999
            ? poolGroupe
            : poolGroupe.filter(p => Math.abs((new Date(p.date_payout) - dateMvt2) / 86400000) <= fenetre)
          subsetPay = _subsetSum(paysFiltres, mouv.credit, 2)
          if (subsetPay) break
        }
        if (subsetPay) {
          // Récupérer les resaIds EN PREMIER
          const allResaIds = []
          let allLinked = true
          for (const p of subsetPay) {
            const { data: prLinks } = await supabase
              .from('payout_reservation').select('reservation_id').eq('payout_id', p.id)
            if (prLinks?.length) {
              allResaIds.push(...prLinks.map(r => r.reservation_id))
            } else {
              // Fallback par payout : fin_revenue exact + platform + mois
              const { data: resaFb } = await supabase
                .from('reservation').select('id')
                .eq('platform', canal).eq('fin_revenue', p.amount).eq('mois_comptable', mois)
              if (resaFb?.length === 1) {
                allResaIds.push(resaFb[0].id)
              } else {
                // Un payout de la combinaison sans lien resa → combinaison invalide, on abandonne
                allLinked = false
                break
              }
            }
          }
          if (!allLinked) { log.skipped++; continue }
          const resaIds = [...new Set(allResaIds.filter(Boolean))]

          // _lierViaPayout crée reservation_paiement + met statut_matching AVANT payout_hospitable
          await _lierViaPayout(mouv.id, resaIds, mouv)

          // Mettre à jour payout_hospitable APRÈS que reservation_paiement existe
          for (const p of subsetPay) {
            await supabase.from('payout_hospitable')
              .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
              .eq('id', p.id)
          }

          for (const p of subsetPay) payoutsCanal.splice(payoutsCanal.indexOf(p), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal + '_groupe', montant: mouv.credit / 100, nb_payouts: subsetPay.length, nb_resas: resaIds.length })
          continue
        }

        log.skipped++
      }
    }

    // ── STRIPE ─────────────────────────────────────────────────────
    // Les virements Stripe correspondent à des réservations directes (platform='direct')
    // On identifie les réservations via stripe_payout_line.reservation_code
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    for (const mouv of mouvStripe) {
      const { data: stripeLines } = await supabase
        .from('stripe_payout_line')
        .select('reservation_code')
        .eq('mouvement_id', mouv.id)
        .not('reservation_code', 'is', null)
      const codes = (stripeLines || []).map(l => l.reservation_code)
      if (!codes.length) { log.skipped++; continue }

      const { data: resaRows } = await supabase
        .from('reservation')
        .select('id')
        .in('code', codes)
      const resaIds = (resaRows || []).map(r => r.id)
      if (!resaIds.length) { log.skipped++; continue }

      await _lierViaPayout(mouv.id, resaIds, mouv)
      log.matched++
      log.details.push({ type: 'stripe_payout', montant: mouv.credit / 100, nb_resas: resaIds.length })
    }

    // ── SEPA/direct : code de résa dans le libellé bancaire ──────────────────
    // Les virements voyageurs manuels portent souvent le code de résa (ex.
    // « VIR INST M.OU MME SKELTON WILL / KDQBMR-KDQBMR » → résa manual KDQBMR,
    // acompte 50 %). Match exact sur le code, unique, avec garde-fou montant.
    // _lierViaPayout gère le partiel : rapprochee ne passe à true que si le total
    // reçu couvre ≥96 % du fin_revenue.
    const sepaLibres = libres.filter(m => m.canal === 'sepa_manuel' && m.statut_matching === 'en_attente' && (m.credit || 0) > 0)
    for (const mouv of sepaLibres) {
      const texte = ((mouv.libelle || '') + ' ' + (mouv.detail || '')).toUpperCase()
      const brut = texte.match(/[A-Z0-9][A-Z0-9-]*[A-Z0-9]/g) || []
      const tokens = [...new Set([...brut, ...brut.flatMap(t => t.split('-'))])]
        .filter(t => t.length >= 5 && t.length <= 12 && !/^[0-9]+$/.test(t))
      if (!tokens.length) continue
      const { data: resasCode } = await supabase
        .from('reservation')
        .select('id, code, fin_revenue, guest_name, bien!inner(agence)')
        .in('platform', ['manual', 'direct'])
        .eq('bien.agence', AGENCE)
        .in('code', tokens)
      if (!resasCode || resasCode.length !== 1) continue   // exactement 1 résa identifiée, sinon revue manuelle
      const resa = resasCode[0]
      // Garde-fou : le virement ne doit pas dépasser le montant de la résa (+1 €)
      if (mouv.credit > (resa.fin_revenue || 0) + 100) { log.skipped++; continue }
      await _lierViaPayout(mouv.id, [resa.id], mouv)
      libres.splice(libres.indexOf(mouv), 1)
      log.matched++
      log.details.push({ type: 'sepa_code_resa', montant: mouv.credit / 100, code: resa.code, guest: resa.guest_name })
    }

    // ── SEPA/direct : nom du voyageur + montant cohérent ─────────────────────
    // Cas « Solde 50 RICHET appt PATXI aout » : pas de code résa dans le libellé,
    // mais un mot du nom (≥4 lettres) + un montant qui colle EXACTEMENT (±1 €) au
    // total, au restant dû, ou à l'acompte 50 %. Candidat unique requis.
    // Fenêtre arrival −3 mois → +13 mois : les acomptes précèdent le séjour.
    const sepaRestants = libres.filter(m => m.canal === 'sepa_manuel' && m.statut_matching === 'en_attente' && (m.credit || 0) > 0)
    if (sepaRestants.length) {
      const dMin = new Date(mois + '-01'); dMin.setMonth(dMin.getMonth() - 3)
      const dMax = new Date(mois + '-01'); dMax.setMonth(dMax.getMonth() + 13)
      const { data: resasDirect } = await supabase
        .from('reservation')
        .select('id, code, guest_name, fin_revenue, bien!inner(agence)')
        .in('platform', ['manual', 'direct'])
        .eq('bien.agence', AGENCE)
        .not('final_status', 'in', '("not accepted","cancelled")')
        .gt('fin_revenue', 0)
        .gte('arrival_date', dMin.toISOString().slice(0, 10))
        .lte('arrival_date', dMax.toISOString().slice(0, 10))
      const normTxt = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      // Restant dû par résa (paiements déjà enregistrés)
      const idsDirect = (resasDirect || []).map(r => r.id)
      const recuByResa = {}
      for (let i = 0; i < idsDirect.length; i += 200) {
        const { data: ps } = await supabase.from('reservation_paiement').select('reservation_id, montant').in('reservation_id', idsDirect.slice(i, i + 200))
        for (const p of (ps || [])) recuByResa[p.reservation_id] = (recuByResa[p.reservation_id] || 0) + (p.montant || 0)
      }
      for (const mouv of sepaRestants) {
        const texte = normTxt((mouv.libelle || '') + ' ' + (mouv.detail || ''))
        const candidats = (resasDirect || []).filter(r => {
          const mots = normTxt(r.guest_name).split(/[^A-Z]+/).filter(w => w.length >= 4)
          if (!mots.some(w => texte.includes(w))) return false
          const restant = (r.fin_revenue || 0) - (recuByResa[r.id] || 0)
          const c = mouv.credit
          return Math.abs(c - restant) <= 100 || Math.abs(c - r.fin_revenue) <= 100 || Math.abs(c - Math.round(r.fin_revenue / 2)) <= 100
        })
        let lier = candidats.length === 1 ? [candidats[0]] : null
        if (!lier) {
          // Multi-résas : même payeur qui règle plusieurs résas en un virement
          // (ex. SO TALENTS : 2 chambres 194,82 + 195,17 = 389,99). Somme des
          // restants dus des résas au nom matché = crédit exact (±1 €).
          const nomMatches = (resasDirect || []).filter(r => {
            const mots = normTxt(r.guest_name).split(/[^A-Z]+/).filter(w => w.length >= 4)
            return mots.some(w => texte.includes(w))
          })
          if (nomMatches.length >= 2 && nomMatches.length <= 6) {
            const sommeRestants = nomMatches.reduce((t, r) => t + Math.max(0, (r.fin_revenue || 0) - (recuByResa[r.id] || 0)), 0)
            if (Math.abs(mouv.credit - sommeRestants) <= 100) lier = nomMatches
          }
        }
        if (!lier) continue
        await _lierViaPayout(mouv.id, lier.map(r => r.id), mouv)
        libres.splice(libres.indexOf(mouv), 1)
        log.matched++
        log.details.push({ type: 'sepa_nom_montant', montant: mouv.credit / 100, code: lier.map(r => r.code).join('+'), guest: lier[0].guest_name })
      }
    }

  } catch (err) {
    log.errors++
    console.error('Erreur matching auto:', err)
  }

  // Journaliser dans import_log — alimente le badge « ⏱ Dernier sync » (cron ET manuel)
  await supabase.from('import_log').insert({
    type:                   'matching_auto',
    mois_concerne:          mois,
    statut:                 log.errors > 0 ? 'partial' : 'success',
    nb_lignes_traitees:     log.matched + log.skipped,
    nb_lignes_creees:       log.matched,
    nb_lignes_mises_a_jour: 0,
    nb_erreurs:             log.errors,
    message: `[${source}] Matching auto ${mois} ${AGENCE} — ${log.matched} rapproché(s), ${log.skipped} ignoré(s), ${log.errors} erreur(s)`,
  }).then(() => {}, () => {})

  return log
}


// ── MATCHING MANUEL ────────────────────────────────────────────

/**
 * Lie manuellement un mouvement bancaire entrant (PAYIN) à des réservations.
 *
 * @param {string} mouvementId - ID du mouvement bancaire (crédit reçu par l'agence)
 * @param {string[]} resaIds - IDs de réservations à associer (directement, sans proxy)
 * @param {string|null} typePaiement - non utilisé actuellement
 */
export async function matcherManuellement(mouvementId, resaIds, typePaiement = null) {
  if (!resaIds.length) throw new Error('Aucune réservation sélectionnée')
  const { data: mvt } = await supabase.from('mouvement_bancaire').select('credit, date_operation').eq('id', mouvementId).single()
  await _lierViaPayout(mouvementId, resaIds, mvt, 'rapproche')
}

export async function marquerNonIdentifie(mouvementId) {
  const { error } = await supabase
    .from('mouvement_bancaire')
    .update({ statut_matching: 'non_identifie' })
    .eq('id', mouvementId)
  if (error) throw error
}

// CF-BQ1/BQ2 : un mouvement est "référencé" s'il a des liens dans ventilation,
// payout_hospitable ou reservation_paiement — quel que soit son statut_matching
// ('rapproche', 'matche_auto', 'matche_manuel', 'non_identifie', 'en_attente'…).
// Sert à décider du nettoyage avant suppression (sinon orphelins).
export async function estMouvementReference(mouvementId) {
  const [v, p, rp] = await Promise.all([
    supabase.from('ventilation').select('id').eq('mouvement_id', mouvementId).limit(1),
    supabase.from('payout_hospitable').select('id').eq('mouvement_id', mouvementId).limit(1),
    supabase.from('reservation_paiement').select('id').eq('mouvement_id', mouvementId).limit(1),
  ])
  return !!(v.data?.length || p.data?.length || rp.data?.length)
}

export async function annulerRapprochement(mouvementId) {
  const { data: mvtLog } = await supabase.from('mouvement_bancaire').select('credit, date_operation, libelle').eq('id', mouvementId).single()

  // Nettoyage résiduel : délier les VIR ventilation encore liés (données créées par l'ancien _lier)
  // Dans le nouveau modèle on ne pose plus jamais ventilation.mouvement_id — ce bloc ne fait rien
  // sur les nouveaux rapprochements mais nettoie les anciens liens legacy
  const { data: virsLegacy } = await supabase
    .from('ventilation')
    .select('id')
    .eq('mouvement_id', mouvementId)
  if (virsLegacy?.length) {
    await supabase.from('ventilation').update({ mouvement_id: null }).in('id', virsLegacy.map(v => v.id))
  }

  // Réservations via payout_hospitable → payout_reservation
  const { data: payoutResas } = await supabase
    .from('payout_hospitable')
    .select('payout_reservation(reservation_id)')
    .eq('mouvement_id', mouvementId)
  const payoutResaIds = (payoutResas || [])
    .flatMap(p => p.payout_reservation || [])
    .map(r => r.reservation_id)
    .filter(Boolean)

  // Réservations via reservation_paiement (Stripe, manuel)
  const { data: paiements } = await supabase
    .from('reservation_paiement')
    .select('reservation_id')
    .eq('mouvement_id', mouvementId)
  const paiementResaIds = (paiements || []).map(p => p.reservation_id).filter(Boolean)

  const allResaIds = [...new Set([...payoutResaIds, ...paiementResaIds])]
  if (allResaIds.length) await supabase.from('reservation').update({ rapprochee: false }).in('id', allResaIds)
  await supabase.from('payout_hospitable').update({ mouvement_id: null, statut_matching: 'en_attente' }).eq('mouvement_id', mouvementId)
  await supabase.from('reservation_paiement').delete().eq('mouvement_id', mouvementId)
  // Resync RGLM + SOLDE après suppression du paiement
  for (const rid of paiementResaIds) await _syncRglmSolde(rid)
  const { error: mvtErr } = await supabase.from('mouvement_bancaire').update({ statut_matching: 'en_attente' }).eq('id', mouvementId)
  if (mvtErr) throw mvtErr
  // Journal
  await logOp({
    categorie: 'rapprochement', action: 'unlink', statut: 'warning', source: 'app',
    mouvement_id: mouvementId,
    mois_comptable: mvtLog?.date_operation?.substring(0, 7),
    message: 'Annulation rapprochement : virement ' + (mvtLog ? (mvtLog.credit/100).toFixed(2) + '€ du ' + mvtLog.date_operation : mouvementId),
    avant: { mouvement_id: mouvementId, libelle: mvtLog?.libelle },
  }).catch(() => {})
}

// ── HELPERS PRIVÉS ─────────────────────────────────────────────

// Synchronise les lignes RGLM (paiements reçus) + SOLDE (reste à encaisser)
// pour les réservations manual/direct payées en plusieurs versements voyageur.
// Appelé après chaque liaison ou annulation de rapprochement.
async function _syncRglmSolde(resaId) {
  const [{ data: resa }, { data: virInfo }] = await Promise.all([
    supabase.from('reservation').select('platform, fin_revenue').eq('id', resaId).single(),
    supabase.from('ventilation').select('bien_id, proprietaire_id, mois_comptable')
      .eq('reservation_id', resaId).eq('code', 'VIR').limit(1).single(),
  ])
  if (!resa || (resa.platform !== 'manual' && resa.platform !== 'direct')) return

  const { data: paiements } = await supabase
    .from('reservation_paiement')
    .select('montant, date_paiement')
    .eq('reservation_id', resaId)
    .order('date_paiement', { ascending: true })

  // Supprimer les RGLM + SOLDE existants puis recréer depuis zéro
  await supabase.from('ventilation').delete()
    .eq('reservation_id', resaId).in('code', ['RGLM', 'SOLDE'])

  if (!paiements?.length) return

  const meta = {
    reservation_id: resaId,
    bien_id: virInfo?.bien_id,
    proprietaire_id: virInfo?.proprietaire_id,
    mois_comptable: virInfo?.mois_comptable,
    taux_tva: 0, montant_tva: 0,
    calcul_source: 'rapprochement',
  }

  // RGLM N : une ligne par paiement reçu
  const rglmLines = paiements.map((p, i) => ({
    ...meta,
    code: 'RGLM',
    libelle: `Règlement ${i + 1}`,
    montant_ttc: p.montant,
    montant_ht: p.montant,
  }))
  if (rglmLines.length) await supabase.from('ventilation').insert(rglmLines)

  // SOLDE : reste à recevoir (disparaît quand = 0)
  const totalRecu = paiements.reduce((s, p) => s + (p.montant || 0), 0)
  const solde = (resa.fin_revenue || 0) - totalRecu
  if (solde > 100) {
    await supabase.from('ventilation').insert({
      ...meta,
      code: 'SOLDE',
      libelle: 'Solde à recevoir',
      montant_ttc: solde,
      montant_ht: solde,
    })
  }
}

/**
 * Lie un mouvement bancaire entrant (crédit reçu par l'agence) à des réservations. Flux 1 pur.
 *
 * Ce que cette fonction fait :
 *   - mouvement_bancaire.statut_matching = 'rapproche'
 *   - reservation.rapprochee = true  (pour chaque resa)
 *   - INSERT reservation_paiement    (traçabilité du paiement reçu)
 *
 * Ce que cette fonction NE fait PAS :
 *   - ventilation.mouvement_id : jamais modifié  ← Flux 2 (reversement proprio), indépendant
 *   - lignes VIR ventilation  : jamais créées ni modifiées
 *
 * IMPORTANT : "VIR" dans le contexte de cette fonction = paiement reçu plateforme/voyageur → agence.
 * Ne pas confondre avec le code VIR de ventilation = reversement agence → propriétaire.
 */
async function _lierViaPayout(mouvementId, resaIds, mvt = null, statut = 'rapproche') {
  // Ne pas marquer rapproché si aucune réservation trouvée — évite les ghost matches
  if (!resaIds.length) return
  // Créer les FK (reservation_paiement) EN PREMIER — le statut rapproché ne doit être
  // positionné qu'une fois les liens en place (évite les ghost matches en cas d'erreur mid-séquence)
  //
  // montant par resa = min(fin_revenue, mvt.credit)
  //   → pour un batch multi-resas : chaque resa reçoit son propre montant (fin_revenue), pas le total du virement
  //   → pour une resa seule : min(fin_revenue, credit) ≈ credit (les 2 sont proches, quelques centimes d'écart possible)
  if (mvt) {
    for (const rid of resaIds) {
      const { data: resa } = await supabase.from('reservation').select('fin_revenue').eq('id', rid).single()
      const finRev = resa?.fin_revenue || 0
      const montant = finRev > 0 ? Math.min(finRev, mvt.credit) : mvt.credit
      // Upsert avec contrainte explicite ; si la contrainte UNIQUE n'existe pas encore en base,
      // l'upsert échoue silencieusement (42P10) → fallback select+insert pour garantir la création
      const { error: upsertErr } = await supabase.from('reservation_paiement').upsert({
        reservation_id: rid,
        mouvement_id: mouvementId,
        montant,
        date_paiement: mvt.date_operation,
        type_paiement: 'total',
      }, {
        onConflict: 'reservation_id,mouvement_id',
        ignoreDuplicates: true
      })
      if (upsertErr) {
        // Fallback : pas de contrainte UNIQUE ou autre erreur → select-then-insert
        const { data: existing } = await supabase.from('reservation_paiement')
          .select('id').eq('reservation_id', rid).eq('mouvement_id', mouvementId).maybeSingle()
        if (!existing) {
          await supabase.from('reservation_paiement').insert({
            reservation_id: rid, mouvement_id: mouvementId, montant,
            date_paiement: mvt.date_operation, type_paiement: 'total',
          })
        }
      }
    }
  }
  // Statut mis à jour APRÈS création des liens FK
  await supabase.from('mouvement_bancaire').update({ statut_matching: statut }).eq('id', mouvementId)
  // rapprochee=true uniquement si paiement complet — si acompte/partiel, laisser false
  // pour que la résa reste visible dans "En attente" et puisse recevoir un second paiement
  for (const rid of resaIds) {
    const [{ data: resa }, { data: allPaiements }] = await Promise.all([
      supabase.from('reservation').select('fin_revenue').eq('id', rid).single(),
      supabase.from('reservation_paiement').select('montant').eq('reservation_id', rid),
    ])
    const totalRecu = (allPaiements || []).reduce((s, p) => s + (p.montant || 0), 0)
    const finRev = resa?.fin_revenue || 0
    const estComplet = finRev === 0 || totalRecu >= finRev * 0.96
    await supabase.from('reservation').update({ rapprochee: estComplet }).eq('id', rid)
  }
  // Sync RGLM + SOLDE pour les resas manual/direct
  for (const rid of resaIds) await _syncRglmSolde(rid)
}

function _subsetSum(virs, cible, tol = 2) {
  const getMontant = (v) => v.amount ?? v.reservation?.fin_revenue ?? v.montant_ttc ?? 0
  // 1. Écarter les payouts plus gros que la cible : ils ne peuvent pas faire partie de la somme.
  //    Sans ce filtre, en haute saison les gros payouts saturaient la liste des candidats et
  //    les petits (ceux qui composent réellement le virement) n'étaient jamais considérés
  //    (juin 2026 : 45 payouts dans la fenêtre, top-12 par montant → 373 € + 326 € invisibles).
  // 2. Trier par montant desc et limiter à 20 candidats pour borner la combinatoire.
  const s = [...virs].filter(v => getMontant(v) <= cible + tol)
    .sort((a, b) => getMontant(b) - getMontant(a)).slice(0, 20)
  const cibleArrondie = Math.round(cible)

  // Tester par taille croissante : 2 par 2, puis 3 par 3, jusqu'à 6
  // Avantage : préférence aux petits groupes (plus probables) et arrêt dès le premier match
  function combiner(debut, taille, restant, sel) {
    if (sel.length === taille) {
      return Math.abs(restant) <= tol ? sel : null
    }
    if (debut >= s.length) return null
    // Élagage : même si on prend tous les éléments restants, peut-on atteindre la cible ?
    const maxPossible = s.slice(debut, debut + (taille - sel.length))
      .reduce((sum, v) => sum + getMontant(v), 0)
    if (restant - maxPossible > tol) return null  // trop petit même au maximum
    if (restant < -tol) return null               // déjà dépassé

    // Essayer avec s[debut]
    const avecDebut = combiner(debut + 1, taille, restant - getMontant(s[debut]), [...sel, s[debut]])
    if (avecDebut) return avecDebut
    // Essayer sans s[debut]
    return combiner(debut + 1, taille, restant, sel)
  }

  for (let taille = 2; taille <= 6; taille++) {
    if (s.length < taille) break
    const res = combiner(0, taille, cibleArrondie, [])
    if (res) return res
  }
  return null
}

/**
 * Promeut en 'rapproche' les mouvements Booking 'en_attente' dont la réconciliation
 * existe déjà dans booking_payout_line (source de vérité Booking, alimentée par le CSV
 * extranet — payout_hospitable est vide pour Booking).
 *
 * Deux cas traités :
 *  (a) Désync : des lignes pointent déjà vers ce mouvement (mouvement_id set) mais le
 *      statut a été perdu (annuler/reset). → promotion directe.
 *  (b) Orphelines : le CSV Booking a été importé avant le relevé bancaire (mouvement_id
 *      NULL). On relie par NO.{payout_id} (libellé/détail) ou, à défaut, par date de
 *      payout (J-5..J) avec somme des nets ≈ crédit, puis on promeut.
 *
 * Mute aussi l'objet en mémoire (statut_matching/detail) pour que la passe d'enrichissement
 * de lancerMatchingAuto (qui ne traite que les mouvements déjà rapprochés) crée ensuite
 * reservation_paiement + reservation.rapprochee.
 */
async function _promouvoirBookingLignes(libres, log) {
  const bookings = libres.filter(m => m.canal === 'booking' && m.statut_matching === 'en_attente' && (m.credit || 0) > 0)
  if (!bookings.length) return

  const COLS = 'id, booking_ref, commission_cents, tourism_tax_cents, property_name, payout_id, amount_cents, payout_date'

  for (const mvt of bookings) {
    try {
      // (a) Lignes déjà liées à ce mouvement.
      // ⚠️ On ne considère QUE les lignes réservation (booking_ref non-null). Les lignes
      // "résumé payout" (booking_ref NULL) sont des doublons polluants — la contrainte
      // UNIQUE(booking_ref, payout_date) ne dédoublonne pas les NULL en Postgres — et
      // l'enrichissement les ignore déjà. Les inclure fausserait la somme de contrôle.
      let { data: lignes } = await supabase
        .from('booking_payout_line').select(COLS)
        .eq('mouvement_id', mvt.id).not('booking_ref', 'is', null)
      lignes = lignes || []

      // (b) Sinon, relier des lignes orphelines
      if (!lignes.length) {
        let orphelines = []
        const refMatch = `${mvt.libelle || ''} ${mvt.detail || ''}`.match(/NO\.([A-Za-z0-9]+)/i)
        const payoutId = refMatch ? refMatch[1] : null
        if (payoutId) {
          const { data } = await supabase
            .from('booking_payout_line').select(COLS)
            .is('mouvement_id', null).not('booking_ref', 'is', null).eq('payout_id', payoutId)
          orphelines = data || []
        }
        if (!orphelines.length) {
          // Fallback par date de payout (J-5..J) : groupe dont la somme nette ≈ crédit
          const d = new Date(mvt.date_operation); d.setDate(d.getDate() - 5)
          const { data } = await supabase
            .from('booking_payout_line').select(COLS)
            .is('mouvement_id', null).not('booking_ref', 'is', null)
            .gte('payout_date', d.toISOString().slice(0, 10))
            .lte('payout_date', mvt.date_operation)
          const groups = {}
          for (const l of (data || [])) (groups[l.payout_date] ||= []).push(l)
          for (const pd of Object.keys(groups)) {
            const somme = groups[pd].reduce((s, l) => s + (l.amount_cents || 0), 0)
            if (Math.abs(somme - mvt.credit) <= 5) { orphelines = groups[pd]; break }
          }
        }
        if (orphelines.length) {
          await supabase.from('booking_payout_line')
            .update({ mouvement_id: mvt.id }).in('id', orphelines.map(l => l.id))
          lignes = orphelines
        }
      }

      if (!lignes.length) continue // rien à promouvoir pour ce mouvement

      // Garde-fou : la somme des nets Booking doit ≈ le crédit bancaire.
      // Sinon le lien est erroné (trop/pas assez de lignes rattachées) → ne pas promouvoir
      // (laisse 'en_attente' pour revue manuelle plutôt que de marquer des montants faux).
      const sommeNets = lignes.reduce((s, l) => s + (l.amount_cents || 0), 0)
      if (Math.abs(sommeNets - mvt.credit) > 200) {
        log.skipped++
        log.details.push({ type: 'booking_lien_incoherent', montant: mvt.credit / 100, somme_lignes: sommeNets / 100, nb_lignes: lignes.length })
        continue
      }

      // Détail enrichi — même format qu'importBookingCSV
      const E = String.fromCharCode(8364) // €
      const nbResas = lignes.filter(l => l.booking_ref).length
      const totalComm = lignes.reduce((s, l) => s + Math.abs(l.commission_cents || 0), 0)
      const totalTax = lignes.reduce((s, l) => s + (l.tourism_tax_cents || 0), 0)
      const props = [...new Set(lignes.filter(l => l.property_name).map(l => l.property_name))]
      const payoutRef = lignes.find(l => l.payout_id)?.payout_id
      const taxSuffix = totalTax > 0 ? ' | taxe séjour: ' + (totalTax / 100).toFixed(2) + E : ''
      const detail = 'Booking | ' + nbResas + ' resa(s) | commission: ' + (totalComm / 100).toFixed(2) + E +
        taxSuffix + (props.length ? ' | ' + props.slice(0, 2).join(', ') : '') + (payoutRef ? ' | ref: ' + payoutRef : '')

      await supabase.from('mouvement_bancaire')
        .update({ statut_matching: 'rapproche', detail }).eq('id', mvt.id)
      mvt.statut_matching = 'rapproche' // pour la passe d'enrichissement de ce même run
      mvt.detail = detail
      log.matched++
      log.details.push({ type: 'booking_promotion', montant: mvt.credit / 100, nb_resas: nbResas })
    } catch (e) {
      log.errors++
      console.error('promotion booking', mvt.id, e?.message)
    }
  }
}

/**
 * Reset complet + re-matching d'un mois
 * - Remet tous les mouvements du mois en en_attente
 * - Supprime tous les reservation_paiement du mois
 * - Remet mouvement_id=null sur les ventilations VIR du mois
 * - Remet rapprochee=false sur les reservations du mois
 * - Relance le matching auto
 */
export async function resetEtRematcher(mois) {
  const log = { mois, reset: 0, matched: 0, errors: 0 }

  try {
    // 1. Récupérer les mouvements du mois
    const { data: mouvements } = await supabase
      .from('mouvement_bancaire')
      .select('id')
      .eq('mois_releve', mois)
      .eq('agence', AGENCE)
      .in('statut_matching', ['rapproche', 'matche_auto'])

    if (!mouvements?.length) {
      const result = await lancerMatchingAuto(mois)
      log.matched = result.matched
      return log
    }

    const mouvIds = mouvements.map(m => m.id)

    // 2. Récupérer les reservation_paiement liés
    const { data: paiements } = await supabase
      .from('reservation_paiement')
      .select('id, reservation_id')
      .in('mouvement_id', mouvIds)

    const resaIds = [...new Set((paiements || []).map(p => p.reservation_id).filter(Boolean))]
    const paiementIds = (paiements || []).map(p => p.id)

    // 3. Remettre mouvement_id=null sur les ventilations VIR
    await supabase
      .from('ventilation')
      .update({ mouvement_id: null })
      .in('mouvement_id', mouvIds)

    // 4. Supprimer les reservation_paiement
    if (paiementIds.length) {
      await supabase
        .from('reservation_paiement')
        .delete()
        .in('id', paiementIds)
    }

    // 5. Remettre rapprochee=false sur les réservations
    if (resaIds.length) {
      await supabase
        .from('reservation')
        .update({ rapprochee: false })
        .in('id', resaIds)
    }

    // 6. Remettre mouvement_id=null sur les payouts Hospitable
    await supabase
      .from('payout_hospitable')
      .update({ mouvement_id: null, statut_matching: 'en_attente' })
      .in('mouvement_id', mouvIds)

    // 7. Remettre les mouvements en en_attente (sauf non_identifie)
    await supabase
      .from('mouvement_bancaire')
      .update({ statut_matching: 'en_attente' })
      .in('id', mouvIds)

    log.reset = mouvIds.length

    // 8. Relancer le matching auto
    const result = await lancerMatchingAuto(mois)
    log.matched = result.matched
    log.errors = result.errors

    // 9. Backfill reservation_paiement pour les matchs créés
    //    (confirmerMatch/confirmerMatchResa le fait en temps réel, mais sécurité)
    const { data: mvtRapproches } = await supabase
      .from('mouvement_bancaire')
      .select('id, credit, date_operation')
      .eq('mois_releve', mois)
      .eq('agence', AGENCE)
      .eq('statut_matching', 'rapproche')
      .gt('credit', 0)
    for (const mvt of mvtRapproches || []) {
      const { data: liens } = await supabase
        .from('payout_hospitable')
        .select('payout_reservation(reservation_id)')
        .eq('mouvement_id', mvt.id)
      for (const ph of liens || []) {
        for (const pr of ph.payout_reservation || []) {
          const { data: existing } = await supabase
            .from('reservation_paiement')
            .select('id').eq('mouvement_id', mvt.id).eq('reservation_id', pr.reservation_id).maybeSingle()
          if (!existing) {
            await supabase.from('reservation_paiement').insert({
              reservation_id: pr.reservation_id, mouvement_id: mvt.id,
              montant: mvt.credit, date_paiement: mvt.date_operation, type_paiement: 'total',
            }).catch(() => {})
          }
        }
      }
    }

  } catch(e) {
    log.errors++
    log.errorMsg = e.message
    console.error('resetEtRematcher error:', e)
  }

  return log
}

/**
 * Rapproche les PAYINs de remboursement de débours (propriétaire qui rembourse une
 * avance ménage/AE au séquestre) avec la facture_evoliz débours correspondante.
 *
 * Flux indépendant du matching résa (Flux 1) : ne touche jamais payout_hospitable ni
 * reservation.rapprochee. Cible spécifiquement canal='sepa_manuel' (ces virements ne
 * matchent ni Airbnb ni Booking) par nom du propriétaire + montant exact.
 *
 * Sur match : facture_evoliz.statut → 'remboursement_recu' (même effet que le clic
 * manuel dans PageFactures), mouvement_bancaire.statut_matching → 'matche_auto'
 * (jamais 'rapproche', réservé au Flux 1 résa / VIRPayinProuvé).
 */
export async function matcherDeboursProprietaires(agence = AGENCE) {
  const norm = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  const [{ data: debours }, { data: mvts }] = await Promise.all([
    supabase.from('facture_evoliz')
      .select('id, total_ttc, proprietaire:proprietaire_id(nom), bien:bien_id(code)')
      .eq('agence', agence)
      .eq('type_facture', 'debours')
      .eq('statut', 'envoye_proprio'),
    supabase.from('mouvement_bancaire')
      .select('id, libelle, detail, credit')
      .eq('agence', agence)
      .eq('statut_matching', 'en_attente')
      .eq('canal', 'sepa_manuel')
      .gt('credit', 0),
  ])

  if (!debours?.length || !mvts?.length) return { lies: 0 }

  const disponibles = [...(mvts || [])]
  let lies = 0

  for (const d of debours) {
    const nomNorm = norm(d.proprietaire?.nom)
    if (!nomNorm) continue

    const candidats = disponibles.filter(m =>
      m.credit === d.total_ttc && norm(`${m.libelle || ''} ${m.detail || ''}`).includes(nomNorm)
    )
    if (candidats.length !== 1) continue

    const m = candidats[0]
    // Pas de colonne note_matching sur mouvement_bancaire (contrairement à d'autres
    // tables du projet) — statut_matching seul suffit à sortir le mouvement de "en_attente".
    const [e1, e2] = await Promise.all([
      supabase.from('facture_evoliz').update({ statut: 'remboursement_recu' }).eq('id', d.id).then(r => r.error),
      supabase.from('mouvement_bancaire')
        .update({ statut_matching: 'matche_auto' })
        .eq('id', m.id).then(r => r.error),
    ])
    if (!e1 && !e2) {
      lies++
      disponibles.splice(disponibles.indexOf(m), 1)
    }
  }

  return { lies }
}
