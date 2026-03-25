/**
 * Service de rapprochement bancaire DCB — Sprint B
 *
 * Stratégie : matching par montant exact
 *   mouvement_bancaire.credit ↔ payout_hospitable.amount (±2 centimes)
 *   → lie mouvement au payout (mouvement_bancaire.statut = rapproche)
 *   → lie les VIR du même mois via subset sum si besoin
 *
 * SEPA/Direct : matching manuel — l'utilisateur choisit les VIR à lier
 */
import { supabase } from '../lib/supabase'
import { logOp } from './journal'

// ── LECTURE ────────────────────────────────────────────────────

export async function getMouvementsMois(mois) {
  const { data, error } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
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

  // Enrichissement secondaire : mouvements rapprochés sans _resa (Airbnb groupés via payout)
  // Matcher par montant de réservation dans le mois
  const nonEnriches = rapproches.filter(m => !m._resa)
  if (nonEnriches.length > 0) {
    const { data: resasByMois } = await supabase
      .select('id, code, guest_name, arrival_date, departure_date, platform, fin_revenue, bien(hospitable_name, agence, airbnb_account)')
      .select('id, code, guest_name, arrival_date, departure_date, platform, fin_revenue, bien(hospitable_name, agence)')
      .eq('mois_comptable', mois)
      .in('platform', ['airbnb', 'booking', 'direct'])
      .gt('fin_revenue', 0)
    const usedResaIds = new Set()
    for (const m of nonEnriches) {
      // Pour Airbnb : filtrer par compte + subset sum pour groupés
      const cands = (resasByMois || []).filter(r => !usedResaIds.has(r.id))
      // Match exact (±2 centimes)
      const exact = cands.find(r => Math.abs((r.fin_revenue || 0) - m.credit) <= 2)
      if (exact) {
        usedResaIds.add(exact.id)
        m._resa = { guest_name: exact.guest_name, bien_name: exact.bien?.hospitable_name, arrival_date: exact.arrival_date, departure_date: exact.departure_date, platform: exact.platform, fin_revenue: exact.fin_revenue, agence: exact.bien?.agence, biens: [exact.bien?.hospitable_name].filter(Boolean), guests: [exact.guest_name].filter(Boolean), reservation_ids: [exact.id], codes: [exact.code], nb_resas: 1 }
      } else if (m.canal === 'airbnb' && cands.length >= 2) {
        // Subset sum groupés Airbnb — même compte uniquement
        // Déterminer le compte du virement via les resas liées (reservation_paiement)
        const compte = cands.find(r => r.bien?.airbnb_account)?.bien?.airbnb_account || null
        const candsFiltered = compte ? cands.filter(r => r.bien?.airbnb_account === compte) : cands
        let sum = 0, resas = [], remaining = m.credit
        const sorted = [...candsFiltered].sort((a,b) => b.fin_revenue - a.fin_revenue)
        for (const r of sorted) {
          if (r.fin_revenue <= remaining + 2) { sum += r.fin_revenue; resas.push(r); remaining -= r.fin_revenue }
          if (Math.abs(remaining) <= 2) break
        }
        if (resas.length > 1 && Math.abs(sum - m.credit) <= 2) {
          resas.forEach(r => usedResaIds.add(r.id))
          m._resa = { guest_name: resas.length + ' voyageur(s)', bien_name: [...new Set(resas.map(r => r.bien?.hospitable_name).filter(Boolean))].join(' | '), platform: 'airbnb', fin_revenue: sum, nb_resas: resas.length, biens: [...new Set(resas.map(r => r.bien?.hospitable_name).filter(Boolean))], guests: resas.map(r => r.guest_name).filter(Boolean), reservation_ids: resas.map(r => r.id), codes: resas.map(r => r.code) }
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

    // ── Stripe : stripe_payout_line → reservation via reservation_code ──────
    if (stripeIds.length > 0) {
      const { data: stripeLines } = await supabase
        .from('stripe_payout_line')
        .select('mouvement_id, reservation_code, guest_name, montant_net, description')
        .in('mouvement_id', stripeIds)
        .eq('type_ligne', 'reservation')

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
          const resa = resaByCode[line.reservation_code]
          if (resa) {
            const bien = resa.bien?.hospitable_name
            if (bien && !info.biens.includes(bien)) info.biens.push(bien)
            if (resa.guest_name && !info.guests.includes(resa.guest_name)) info.guests.push(resa.guest_name)
            if (!info.reservation_ids.includes(resa.id)) info.reservation_ids.push(resa.id)
            if (!info.codes.includes(resa.code)) info.codes.push(resa.code)
            info.fin_revenue += (resa.fin_revenue || 0)
            info.nights += (resa.nights || 0)
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
            info.fin_revenue += (resa.fin_revenue || 0)
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
            // Alimenter reservation_paiement (automatique pour les prochains virements)
            for (const resaId of info.reservation_ids) {
              const bRef = Object.keys(resaByRef).find(k => resaByRef[k]?.id === resaId)
              const line = bookingLines?.find(l => l.booking_ref === bRef)
              const montant = line ? line.amount_cents : m.credit
              const finRev = resaByRef[bRef]?.fin_revenue || 0
              supabase.from('reservation_paiement').upsert({
                reservation_id: resaId, mouvement_id: m.id,
                montant, date_paiement: m.date_operation,
                type_paiement: (finRev && montant >= finRev * 0.99) ? 'total' : 'acompte'
              }, { onConflict: 'reservation_id,mouvement_id', ignoreDuplicates: true }).then(() => {})
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

export async function getVirNonRapproches(mois) {
  // Charge les VIR non rapproch?s : -2 mois jusqu'? +6 mois (fenetre glissante)
  // Couvre les accomptes (paiement avant s?jour) et les arr?r?s r?cents
  const now = new Date()
  const dateMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 7)
  const dateMax = new Date(now.getFullYear(), now.getMonth() + 7, 1).toISOString().slice(0, 7)
  const { data, error } = await supabase
    .from('ventilation')
    .select(`
      id, code, montant_ttc, mouvement_id, mois_comptable,
      reservation (id, code, platform, guest_name, arrival_date, departure_date, nights, fin_revenue, final_status,
        bien (code, hospitable_name, gestion_loyer, agence))
    `)
    .eq('code', 'VIR')
    .is('mouvement_id', null)
    .gte('mois_comptable', dateMin)
    .lte('mois_comptable', dateMax)
    .order('mois_comptable', { ascending: false })
  if (error) throw error
  // Exclure les réservations annulées
  return (data || []).filter(v =>
    v.reservation?.final_status !== 'not accepted' &&
    v.reservation?.final_status !== 'cancelled'
  )
}

export async function getStatsRapprochement(mois) {
  const [{ data: m }, { data: v }] = await Promise.all([
    supabase.from('mouvement_bancaire').select('statut_matching,credit,debit,canal').eq('mois_releve', mois),
    supabase.from('ventilation').select('montant_ttc,mouvement_id').eq('mois_comptable', mois).eq('code', 'VIR').not('bien_id', 'is', null),
  ])
  const mouvements = m || [], virs = v || []
  return {
    total_mouvements: mouvements.length,
    rapproches: mouvements.filter(x => x.statut_matching === 'rapproche').length,
    en_attente: mouvements.filter(x => x.statut_matching === 'en_attente' && (x.credit || 0) > 0).length,
    non_identifie: mouvements.filter(x => x.statut_matching === 'non_identifie').length,
    total_entrees: mouvements.filter(x => x.credit > 0).reduce((s, x) => s + (x.credit || 0), 0),
    total_sorties: mouvements.filter(x => x.debit > 0).reduce((s, x) => s + (x.debit || 0), 0),
    vir_total: virs.length,
    vir_rapproches: virs.filter(x => x.mouvement_id !== null).length,
    vir_montant_total: virs.reduce((s,v) => s + (v.montant_ttc || 0), 0),
  }
}

// ── MATCHING AUTO ──────────────────────────────────────────────

export async function lancerMatchingAuto(mois) {
  const log = { matched: 0, skipped: 0, errors: 0, details: [] }

  try {
    // Mouvements du mois en attente avec entrée (credit > 0)
    const mouvements = await getMouvementsMois(mois)
    const libres = mouvements.filter(m => m.statut_matching === 'en_attente' && (m.credit || 0) > 0)

    // VIR non rapprochés du mois
    const virs = await getVirNonRapproches(mois)

    // Charger TOUS les payouts sans mouvement (pas de filtre par date)
    // Les payouts Hospitable peuvent dater de n importe quand
    // On pagine par 1000 pour tout récupérer
    let payoutsAll = []
    let from = 0
    const PAGE = 1000
    while (true) {
      const { data: page } = await supabase
        .from('payout_hospitable')
        .select('id, amount, platform, date_payout, mouvement_id')
        .is('mouvement_id', null)
        .range(from, from + PAGE - 1)
      if (!page || page.length === 0) break
      payoutsAll.push(...page)
      if (page.length < PAGE) break
      from += PAGE
    }

    // ── AIRBNB + BOOKING ───────────────────────────────────────────
    for (const canal of ['airbnb', 'booking']) {
      const mouvCanal = libres.filter(m => m.canal === canal)
      const payoutsCanal = payoutsAll.filter(p => p.platform === canal)
      const virCanal = virs.filter(v => v.reservation?.platform === canal)

      for (const mouv of mouvCanal) {

        // Étape 1 : montant exact (1 payout = 1 mouvement) — cas principal ~99%
        const payoutExact = payoutsCanal.find(p => Math.abs(p.amount - mouv.credit) <= 2)

        if (payoutExact) {
          await supabase.from('payout_hospitable')
            .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
            .eq('id', payoutExact.id)

          // Chercher les VIR via payout_reservation
          let virIds = []
          const { data: prLinks } = await supabase
            .from('payout_reservation')
            .select('reservation_id')
            .eq('payout_id', payoutExact.id)
          if (prLinks?.length) {
            const resaIds = prLinks.map(r => r.reservation_id)
            const matched = virCanal.filter(v => resaIds.includes(v.reservation?.id))
            if (matched.length) virIds = matched.map(v => v.id)
          }

          // Fallback VIR : montant exact sur VIR
          if (virIds.length === 0) {
            const exact = virCanal.find(v => Math.abs((v.reservation?.fin_revenue ?? v.montant_ttc ?? 0) - mouv.credit) <= 2)
            if (exact) virIds = [exact.id]
          }

          // Fallback VIR : subset sum
          if (virIds.length === 0) {
            const subset = _subsetSum(virCanal.filter(v => !v.mouvement_id), mouv.credit)
            if (subset) virIds = subset.map(v => v.id)
          }

          if (virIds.length > 0) {
            await _lier(mouv.id, virIds)
          } else {
            await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche' })
              .eq('id', mouv.id)
          }

          payoutsCanal.splice(payoutsCanal.indexOf(payoutExact), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal + '_exact', montant: mouv.credit / 100, nb_virs: virIds.length })
          continue
        }


        // Etape 2 : regroupement N payouts -> 1 mouvement (Airbnb groupe par compte)
        // Fenetres de date croissantes : +/-2j, +/-7j, +/-14j, tout
        const dateMvt2 = new Date(mouv.date_operation)
        const FENETRES_AIRBNB = [2, 7, 14, 999]
        let subsetPay = null
        for (const fenetre of FENETRES_AIRBNB) {
          const paysFiltres = fenetre >= 999
            ? payoutsCanal
            : payoutsCanal.filter(p => Math.abs((new Date(p.date_payout) - dateMvt2) / 86400000) <= fenetre)
          subsetPay = _subsetSum(paysFiltres, mouv.credit, 2)
          if (subsetPay) break
        }
        if (subsetPay) {
          for (const p of subsetPay) {
            await supabase.from('payout_hospitable')
              .update({ mouvement_id: mouv.id, statut_matching: 'rapproche' })
              .eq('id', p.id)
          }

          let virIds = []
          const allResaIds = []
          for (const p of subsetPay) {
            const { data: prLinks } = await supabase
              .from('payout_reservation').select('reservation_id').eq('payout_id', p.id)
            if (prLinks?.length) allResaIds.push(...prLinks.map(r => r.reservation_id))
          }
          if (allResaIds.length) {
            const matched = virCanal.filter(v => !v.mouvement_id && allResaIds.includes(v.reservation?.id))
            if (matched.length) virIds = matched.map(v => v.id)
          }
          if (virIds.length === 0) {
            const subset = _subsetSum(virCanal.filter(v => !v.mouvement_id), mouv.credit)
            if (subset) virIds = subset.map(v => v.id)
          }

          if (virIds.length > 0) {
            await _lier(mouv.id, virIds)
          } else {
            await supabase.from('mouvement_bancaire')
              .update({ statut_matching: 'rapproche' })
              .eq('id', mouv.id)
          }

          for (const p of subsetPay) payoutsCanal.splice(payoutsCanal.indexOf(p), 1)
          libres.splice(libres.indexOf(mouv), 1)
          log.matched++
          log.details.push({ type: canal + '_groupe', montant: mouv.credit / 100, nb_payouts: subsetPay.length, nb_virs: virIds.length })
          continue
        }

        log.skipped++
      }
    }

    // ── STRIPE ─────────────────────────────────────────────────────
    const mouvStripe = libres.filter(m => m.canal === 'stripe')
    const virStripe = virs.filter(v => v.reservation?.platform === 'stripe' && !v.mouvement_id)
    for (const mouv of mouvStripe) {
      const exact = virStripe.find(v => Math.abs(v.montant_ttc - mouv.credit) <= 2)
      if (exact) {
        await _lier(mouv.id, [exact.id])
        log.matched++
        log.details.push({ type: 'stripe_exact', montant: mouv.credit / 100 })
        continue
      }
      const total = virStripe.reduce((s, v) => s + v.montant_ttc, 0)
      if (total > 0 && Math.abs(total - mouv.credit) / mouv.credit < 0.05) {
        await _lier(mouv.id, virStripe.map(v => v.id))
        log.matched++
        log.details.push({ type: 'stripe_total', montant: mouv.credit / 100, nb_virs: virStripe.length })
        continue
      }
      log.skipped++
    }

  } catch (err) {
    log.errors++
    console.error('Erreur matching auto:', err)
  }
  return log
}


// ── MATCHING MANUEL ────────────────────────────────────────────

export async function matcherManuellement(mouvementId, virIds, typePaiement = null) {
  await _lier(mouvementId, virIds, 'rapproche', typePaiement)
}

export async function marquerNonIdentifie(mouvementId) {
  const { error } = await supabase
    .from('mouvement_bancaire')
    .update({ statut_matching: 'non_identifie' })
    .eq('id', mouvementId)
  if (error) throw error
}

export async function annulerRapprochement(mouvementId) {
  // Récupérer le mouvement pour le log
  const { data: mvtLog } = await supabase.from('mouvement_bancaire').select('credit, date_operation, libelle').eq('id', mouvementId).single()
  const { data: virs } = await supabase
    .from('ventilation')
    .select('id, reservation_id')
    .eq('mouvement_id', mouvementId)
  if (virs?.length) {
    await supabase.from('ventilation').update({ mouvement_id: null }).in('id', virs.map(v => v.id))
    const resaIds = [...new Set(virs.map(v => v.reservation_id).filter(Boolean))]
    if (resaIds.length) await supabase.from('reservation').update({ rapprochee: false }).in('id', resaIds)
  }
  await supabase.from('payout_hospitable').update({ mouvement_id: null, statut_matching: 'en_attente' }).eq('mouvement_id', mouvementId)
  // Supprimer les paiements enregistrés pour ce virement (annulation du rapprochement)
  await supabase.from('reservation_paiement').delete().eq('mouvement_id', mouvementId)
  await supabase.from('mouvement_bancaire').update({ statut_matching: 'en_attente' }).eq('id', mouvementId)
  // Journal
  await logOp({
    categorie: 'rapprochement', action: 'unlink', statut: 'warning', source: 'app',
    mouvement_id: mouvementId,
    message: 'Annulation rapprochement : virement ' + (mvtLog ? (mvtLog.credit/100).toFixed(2) + '€ du ' + mvtLog.date_operation : mouvementId),
    avant: { mouvement_id: mouvementId, libelle: mvtLog?.libelle },
  }).catch(() => {})
}

// ── HELPERS PRIVÉS ─────────────────────────────────────────────

async function _lier(mouvementId, virIds, statut = 'rapproche', typePaiement = null) {
  // Lier les VIR ? ce mouvement
  await supabase.from('ventilation').update({ mouvement_id: mouvementId }).in('id', virIds)
  await supabase.from('mouvement_bancaire').update({ statut_matching: statut }).eq('id', mouvementId)

  // R?cup?rer les r?servations et le mouvement
  const { data: v } = await supabase.from('ventilation')
    .select('reservation_id')
    .in('id', virIds)
  const { data: mvt } = await supabase.from('mouvement_bancaire')
    .select('credit, date_operation')
    .eq('id', mouvementId)
    .single()

  if (v?.length) {
    const ids = [...new Set(v.map(x => x.reservation_id).filter(Boolean))]
    if (ids.length) {
      // Marquer les r?servations comme rapproch?es
      await supabase.from('reservation').update({ rapprochee: true }).in('id', ids)

      // Enregistrer dans reservation_paiement
      if (mvt) {
        // D?terminer le type : si d?j? un paiement existe pour cette resa → acompte/solde
        const { data: existing } = await supabase
          .from('reservation_paiement')
          .select('id')
          .in('reservation_id', ids)
        const type = typePaiement || (existing?.length ? 'solde' : 'acompte')
        const paiements = ids.map(rid => ({
          reservation_id: rid,
          mouvement_id: mouvementId,
          montant: mvt.credit,
          date_paiement: mvt.date_operation,
          type_paiement: type,
        }))
        await supabase.from('reservation_paiement').upsert(paiements, {
          onConflict: 'reservation_id,mouvement_id',
          ignoreDuplicates: true
        })
      }
    }
  }
}

function _subsetSum(virs, cible, tol = 2) {
  const getMontant = (v) => v.reservation?.fin_revenue ?? v.montant_ttc ?? 0
  const s = [...virs].sort((a, b) => getMontant(b) - getMontant(a)).slice(0, 9)
    if (Math.abs(r) <= tol) return sel
    if (i >= s.length || r < -tol || sel.length >= 6) return null
    return f(i + 1, r - getMontant(s[i]), [...sel, s[i]]) || f(i + 1, r, sel)
  }
  const res = f(0, Math.round(cible), [])
  return res && res.length > 1 ? res : null
}
