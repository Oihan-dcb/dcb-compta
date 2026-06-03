/**
 * buildRapportData(bienId, propId, mois, opts)
 *
 * Source de vérité unique pour tous les calculs mensuels propriétaire.
 * Appelée par PageRapports, rapportProprietaire, rapportStatement.
 * Aucun recalcul divergent ailleurs.
 *
 * Règles métier centralisées :
 *  - gross_revenue  = fin_accommodation + guest_fees (raw Hospitable)
 *  - base_comm      = fin_accommodation (Hospitable "Commissionable base")
 *  - fraisDeductionLoy : si statut='facture' && statut_deduction!='en_attente' → montant_deduit_loy
 *                        si statut='facture' && statut_deduction='en_attente'   → fallback montant_ttc
 *                        si statut='a_facturer'                                 → montant_ttc
 *  - virementNet    : facture.montant_reversement si statut hors brouillon/calcul_en_cours
 *                     sinon virTotal - debours - haowner - fraisDeductionLoy - ownerStayMenage
 *  - honTotal kpis  : facture.total_ttc si facture présente, sinon sum ventilation HON
 */

import { supabase } from '../lib/supabase'
import { STATUTS_NON_VENTILABLES } from '../lib/constants'

export async function buildRapportData(bienId, propId, mois, opts = {}) {
  const { isGlobal = false, maiteIds = [] } = opts
  const [y, m] = mois.split('-').map(Number)
  const nuitsDispos = new Date(y, m, 0).getDate()
  const moisN1 = `${y - 1}-${String(m).padStart(2, '0')}`
  const moisSuivant = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const prev3Mois = Array.from({ length: 3 }, (_, i) => {
    let mm = m - (i + 1); let yy = y
    while (mm <= 0) { mm += 12; yy-- }
    return `${yy}-${String(mm).padStart(2, '0')}`
  })

  // ── Requêtes parallèles ──────────────────────────────────────────────────
  const [
    { data: resas, error: resasErr },
    { data: resasN1 },
    { data: fraisData },
    { data: facture },
    bienConfig,
    { data: virHisto },
  ] = await Promise.all([
    // 1. Réservations avec reservation_fee pour gross_revenue exact
    (() => {
      let q = supabase
        .from('reservation')
        .select('id, bien_id, code, fin_revenue, fin_accommodation, fin_host_service_fee, fin_gross_revenue, fin_discount, nights, arrival_date, departure_date, final_status, platform, owner_stay, guest_name, hospitable_raw, bien:bien_id(hospitable_name, code, forfait_menage_proprio), reservation_fee(fee_type, label, amount)')
        .eq('mois_comptable', mois)
        .order('arrival_date')
      return isGlobal ? q.in('bien_id', maiteIds) : q.eq('bien_id', bienId)
    })(),
    // 2. N-1 (même mois, année précédente)
    (() => {
      let q = supabase
        .from('reservation')
        .select('id, fin_revenue, nights, final_status')
        .eq('mois_comptable', moisN1)
        .neq('final_status', 'cancelled')
      return isGlobal ? q.in('bien_id', maiteIds) : q.eq('bien_id', bienId)
    })(),
    // 3. Frais propriétaire avec tous les champs nécessaires
    (() => {
      let q = supabase
        .from('frais_proprietaire')
        .select('id, libelle, montant_ttc, statut, date, mode_traitement, montant_deduit_loy, montant_reliquat, statut_deduction')
        .gte('date', `${mois}-01`)
        .lt('date', `${moisSuivant}-01`)
      return isGlobal ? q.in('bien_id', maiteIds) : q.eq('bien_id', bienId)
    })(),
    // 4. Facture honoraires du mois
    supabase
      .from('facture_evoliz')
      .select('id, id_evoliz, statut, total_ttc, montant_reversement')
      .eq('proprietaire_id', propId)
      .eq('mois', mois)
      .eq('type_facture', 'honoraires')
      .maybeSingle(),
    // 5. Taux de commission
    supabase
      .from('bien')
      .select('taux_commission_override, mode_encaissement, proprietaire:proprietaire_id(taux_commission)')
      .eq('id', bienId)
      .maybeSingle()
      .then(r => ({
        tauxCommission:   r.data?.taux_commission_override || r.data?.proprietaire?.taux_commission || 25,
        modeEncaissement: r.data?.mode_encaissement || 'dcb',
      })),
    // 6. Ventilation historique VIRProprio (3 mois précédents) pour projection
    (() => {
      let q = supabase
        .from('ventilation')
        .select('mois_comptable, montant_ht')
        .in('mois_comptable', prev3Mois)
        .eq('code', 'VIR')
      return isGlobal ? q.in('bien_id', maiteIds) : q.eq('bien_id', bienId)
    })(),
  ])

  if (resasErr) throw new Error(resasErr.message)

  const tauxCommission    = bienConfig.tauxCommission
  const modeEncaissement  = bienConfig.modeEncaissement

  const resasValides = (resas || []).filter(r =>
    !STATUTS_NON_VENTILABLES.includes(r.final_status) || (r.fin_revenue || 0) > 0
  )
  const resaIds = resasValides.map(r => r.id)

  // ── Détection prolongations ──────────────────────────────────────────────
  // Même bien + même voyageur + dates consécutives + pas de frais ménage
  const byBienGuest = {}
  for (const r of resasValides) {
    const key = `${r.bien_id}|${(r.guest_name || '').toLowerCase().trim()}`
    if (!byBienGuest[key]) byBienGuest[key] = []
    byBienGuest[key].push(r)
  }
  for (const group of Object.values(byBienGuest)) {
    if (group.length < 2) continue
    for (const r of group) {
      const fees = r.reservation_fee || []
      const cleaning = fees.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0
      const community = fees.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
      if (cleaning > 0 || community > 0) continue
      const preceding = group.find(o => o.id !== r.id && (o.departure_date || '').substring(0, 10) === (r.arrival_date || '').substring(0, 10))
      if (preceding) { r.isProlongation = true; r.originalResaCode = preceding.code }
    }
  }
  for (const r of resasValides) {
    if (!r.isProlongation && (r.guest_name || '').toLowerCase().includes('prolongation')) r.isProlongation = true
  }

  // Pour mode_encaissement='proprio' : Airbnb/Booking sont perçus directement
  // par le proprio — pas de reversement DCB sur ces resas
  const PLATFORMS_DCB = ['direct', 'manual']
  const resaPlatformMap = new Map(resasValides.map(r => [r.id, r.platform || '']))
  const isProprioEncaisse = (resaId) =>
    modeEncaissement === 'proprio' && !PLATFORMS_DCB.includes(resaPlatformMap.get(resaId) || '')

  // ── Ventilation + Encaissements ─────────────────────────────────────────
  let loyTotal = 0, honTotalVent = 0, virTotal = 0, virTotalProprioEncaisse = 0
  let ventByResa = {}, paiementsByResa = {}
  if (resaIds.length) {
    const [{ data: ventsData }, { data: paiementsData }] = await Promise.all([
      supabase
        .from('ventilation')
        .select('reservation_id, code, montant_ht, montant_ttc, montant_reel, calcul_source')
        .in('reservation_id', resaIds)
        .in('code', ['HON', 'LOY', 'VIR', 'FMEN', 'AUTO', 'MEN']),
      supabase
        .from('reservation_paiement')
        .select('reservation_id, montant')
        .in('reservation_id', resaIds),
    ])
    const vents = ventsData || []
    for (const v of vents) {
      // Les lignes VIR résiduelles (rapprochement partiel) sont exclues des rapports
      if (v.code === 'VIR' && v.calcul_source === 'residuel') continue
      if (!ventByResa[v.reservation_id]) ventByResa[v.reservation_id] = {}
      ventByResa[v.reservation_id][v.code] = v
    }
    loyTotal               = vents.filter(v => v.code === 'LOY').reduce((s, v) => s + (v.montant_ht  || 0), 0)
    honTotalVent           = vents.filter(v => v.code === 'HON').reduce((s, v) => s + (v.montant_ttc || 0), 0)
    virTotal               = vents.filter(v => v.code === 'VIR' && v.calcul_source !== 'residuel' && !isProprioEncaisse(v.reservation_id)).reduce((s, v) => s + (v.montant_ht || 0), 0)
    virTotalProprioEncaisse = vents.filter(v => v.code === 'VIR' && v.calcul_source !== 'residuel' &&  isProprioEncaisse(v.reservation_id)).reduce((s, v) => s + (v.montant_ht || 0), 0)
    for (const p of (paiementsData || [])) {
      paiementsByResa[p.reservation_id] = (paiementsByResa[p.reservation_id] || 0) + (p.montant || 0)
    }
  }

  // ── Prestations hors forfait ─────────────────────────────────────────────
  let prestations = []
  try {
    let q = supabase
      .from('prestation_hors_forfait')
      .select('id, bien_id, reservation_id, date_prestation, description, montant, type_imputation, prestation_type:prestation_type_id(nom), ae:ae_id(type)')
      .eq('mois', mois)
      .eq('statut', 'valide')
      .in('type_imputation', ['deduction_loy', 'debours_proprio', 'haowner'])
    if (isGlobal) {
      if (maiteIds.length > 0) {
        const { data: phfData } = await q.in('bien_id', maiteIds)
        prestations = phfData || []
      }
    } else {
      const { data: phfData } = await q.eq('bien_id', bienId)
      prestations = phfData || []
    }
  } catch (_) { /* ne bloque pas */ }

  const extraByResa = {}
  const extrasParResa = []
  ;(prestations || [])
    .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation) && p.reservation_id)
    .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
    .forEach(p => {
      const isStaff = p.type_imputation === 'deduction_loy' && p.ae?.type === 'staff'
      const montantEffectif = isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0)
      extraByResa[p.reservation_id] = (extraByResa[p.reservation_id] || 0) + montantEffectif
      extrasParResa.push({ ...p, libelle: p.description || p.prestation_type?.nom || '—', isStaff, montant_ht: p.montant, montant_ttc: montantEffectif })
    })

  const extrasGlobaux = (prestations || [])
    .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation) && !p.reservation_id)
    .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
    .map(p => {
      const isStaff = p.type_imputation === 'deduction_loy' && p.ae?.type === 'staff'
      const montantEffectif = isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0)
      return { ...p, libelle: p.description || p.prestation_type?.nom || '—', isStaff, montant_ht: p.montant, montant_ttc: montantEffectif }
    })

  const haownerList = (prestations || [])
    .filter(p => p.type_imputation === 'haowner')
    .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
    .map(p => ({ ...p, montant_ttc: Math.round((p.montant || 0) * 1.20), libelle: p.description || p.prestation_type?.nom || '—' }))

  const totalDebours = (prestations || [])
    .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation))
    .reduce((s, p) => {
      const isStaff = p.type_imputation === 'deduction_loy' && p.ae?.type === 'staff'
      return s + (isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0))
    }, 0)
  const totalHaowner = haownerList.reduce((s, p) => s + (p.montant_ttc || 0), 0)

  // ── Helper gross_revenue ─────────────────────────────────────────────────
  // gross_revenue = total payé par le voyageur (hors remitted taxes reversées directement)
  // Direct  : total_price CSV (fin_gross_revenue)
  // Booking : accommodation + guest_fees + pass_through_taxes (= ce que Hospitable affiche)
  //   → si reservation_fee vide (fees non synchés) : fallback fin_gross_revenue - CITY_TAX withheld
  // Airbnb  : accommodation + guest_fees (guest_service_fee exclus — payé à Airbnb, pas à DCB)
  // Manual  : accommodation + guest_fees + taxes (pass-through = taxe de séjour incluse dans fin_revenue)
  const computeGrossRevenue = (r) => {
    if (r.owner_stay) return 0
    if (r.platform === 'direct' && r.fin_gross_revenue) return r.fin_gross_revenue
    const hasFees = (r.reservation_fee || []).length > 0
    if (r.platform === 'booking' && !hasFees && r.fin_gross_revenue) {
      const withheld = ((r.hospitable_raw?.financials?.guest?.taxes) || [])
        .filter(t => t.label?.toLowerCase().includes('withheld'))
        .reduce((s, t) => s + (t.amount || 0), 0)
      return r.fin_gross_revenue - withheld
    }
    return (r.fin_accommodation || 0) +
      (r.reservation_fee || []).filter(f => f.fee_type === 'guest_fee').reduce((s, f) => s + (f.amount || 0), 0) +
      (r.platform === 'booking'
        ? (r.reservation_fee || []).filter(f => f.fee_type === 'tax' && !f.label?.toLowerCase().includes('remitted')).reduce((s, f) => s + (f.amount || 0), 0)
        : 0) +
      (r.platform === 'manual'
        ? (r.reservation_fee || []).filter(f => f.fee_type === 'tax').reduce((s, f) => s + (f.amount || 0), 0)
        : 0) -
      (r.platform === 'airbnb' ? (r.fin_discount || 0) : 0)
  }

  // ── Enrichissement par réservation ───────────────────────────────────────
  const resasEnrichies = resasValides.map(r => {
    const v = ventByResa[r.id] || {}
    const virHt = v.VIR?.montant_ht || 0
    const loyHt = v.LOY?.montant_ht || 0
    const grossRev = computeGrossRevenue(r)

    // taxe_sejour_directe : pour direct/manual, DCB collecte la taxe de séjour auprès du voyageur
    // et doit la reverser à la mairie — à déduire du NET plateforme
    const taxeSejDirecte = !r.owner_stay && ['direct', 'manual'].includes(r.platform || '')
      ? (r.reservation_fee || []).filter(f => f.fee_type === 'tax').reduce((s, f) => s + (f.amount || 0), 0)
      : 0

    // taxe unifiée pour la colonne Taxe :
    // direct/manual → taxe collectée (reservation_fee fee_type='tax')
    // Airbnb/Booking → VIR-LOY (taxe de séjour incluse dans le payout, reversée au proprio)
    const taxeDisplay = taxeSejDirecte > 0 ? taxeSejDirecte : Math.max(0, virHt - loyHt)

    // frais_plateforme = ce que retient le canal de distribution
    // Airbnb/Booking : fin_host_service_fee est négatif (commission prélevée par la plateforme)
    //   → source fiable même si reservation_fee est vide
    // direct/manual  : frais Hospitable (gross - fin_revenue) + management fee DCB
    const mgmtFee = ['direct', 'manual'].includes(r.platform || '')
      ? (r.reservation_fee || [])
          .filter(f => f.fee_type === 'guest_fee' && f.label?.toLowerCase().includes('management'))
          .reduce((s, f) => s + (f.amount || 0), 0)
      : 0
    const fraisPlat = r.owner_stay ? 0 :
      ['direct', 'manual'].includes(r.platform || '')
        ? Math.max(0, grossRev - (r.fin_revenue || 0)) + mgmtFee
        : Math.max(0, -(r.fin_host_service_fee || 0))

    // net_plateforme = ce que reçoit DCB après frais plateforme et taxe de séjour
    // Airbnb/Booking : fin_revenue est la source fiable (reversement Hospitable)
    // direct/manual  : grossRev - fraisPlat - taxeSejDirecte (reconstruction car fin_revenue inclut la taxe)
    const netPlat = r.owner_stay ? 0
      : ['direct', 'manual'].includes(r.platform || '')
        ? grossRev - fraisPlat - taxeSejDirecte
        : (r.fin_revenue || 0)

    return {
      ...r,
      vent: v,
      extra: extraByResa[r.id] || 0,
      gross_revenue: grossRev,
      // base_comm = fin_accommodation + fin_host_service_fee - fin_discount
      // = "Commissionable base" Hospitable (net de la commission hôte + remises promotionnelles)
      // fin_host_service_fee est négatif, fin_discount est positif en base (à soustraire)
      base_comm: (r.fin_accommodation || 0) + (r.fin_host_service_fee || 0) - (r.fin_discount || 0),
      proprio_encaisse: isProprioEncaisse(r.id),
      hon:  v.HON?.montant_ttc || 0,
      loy:  loyHt,
      vir:  virHt,
      fmen: v.FMEN?.montant_ttc || 0,
      taxe: taxeDisplay,
      frais_plateforme: fraisPlat,
      net_plateforme: netPlat,
      // encaissement : pour direct/manual/stripe, les frais Stripe sont remboursés depuis
      // le compte courant vers le séquestre → encaissement = brut voyageur
      // Pour Airbnb/Booking : payout réel reçu en banque
      encaissement: ['direct', 'manual', 'stripe'].includes(r.platform || '')
        ? grossRev
        : (paiementsByResa[r.id] || 0),
      // menage_voyageur = ménage collecté auprès du voyageur (normal resas only)
      // Pour owner_stay : le ménage est dans DÉBOURS (FMEN+AUTO), pas dans les colonnes voyageur
      menage_voyageur: r.owner_stay ? 0 : (v.FMEN?.montant_ttc || 0) + (v.AUTO?.montant_ht || 0),
    }
  })

  // ── Owner stay ménage ────────────────────────────────────────────────────
  // ownerStayList : une ligne par résa proprio (pour affichage dans charges)
  const ownerStayList = resasEnrichies
    .filter(r => r.owner_stay)
    .map(r => {
      const vent = ventByResa[r.id] || {}
      // FMEN TTC + AUTO réel (ou HT) = montant total ménage owner
      // FMEN.montant_ttc car TVA incluse → 6000 + AUTO 2500 = 8500 cts = 85 €
      const fmen = vent.FMEN?.montant_ttc || 0
      const auto = vent.AUTO?.montant_reel ?? vent.AUTO?.montant_ht ?? 0
      const montantVentile = fmen + auto
      // Fallback si pas encore ventilé : fin_accommodation > fin_revenue > forfait_menage_proprio
      // Tous en centimes — fmt() divise par 100
      const fallback = r.fin_accommodation || r.fin_revenue || r.bien?.forfait_menage_proprio || 0
      return {
        id: r.id,
        bien_id: r.bien_id,
        arrival_date: r.arrival_date,
        guest_name: r.guest_name,
        libelle: 'Ménage séjour propriétaire',
        montant: montantVentile > 0 ? montantVentile : fallback,
        // a_saisir : bouton manuel si aucune donnée (ni ventilation, ni DB fallback)
        a_saisir: montantVentile === 0 && fallback === 0,
      }
    })
  const ownerStayMenageTotal = ownerStayList.reduce((s, r) => s + r.montant, 0)

  // ── fraisDeductionLoy — règle unique ─────────────────────────────────────
  const fraisDeductionLoy = (fraisData || []).reduce((s, f) => {
    if (f.mode_traitement === 'deduire_loyer') {
      if (f.statut === 'facture' && f.statut_deduction !== 'en_attente') return s + (f.montant_deduit_loy || 0)
      if (f.statut === 'facture' && f.statut_deduction === 'en_attente')  return s + (f.montant_ttc || 0)
      if (f.statut === 'a_facturer')                                       return s + (f.montant_ttc || 0)
    }
    if (f.mode_traitement === 'remboursement' && f.statut !== 'brouillon') {
      return s - (f.montant_ttc || 0)
    }
    return s
  }, 0)

  // ── virementNet — règle unique ───────────────────────────────────────────
  // BRANCHE 1 : facture confirmée (hors brouillon/calcul_en_cours) → montant_reversement est la vérité
  // BRANCHE 2 : recalcul depuis virTotal
  // ownerStayAbsorbBranche2 = seule la part couverte par le LOY résiduel réduit le reversement
  // Le surplus owner stay est facturé séparément (ligne "Ménage séjour propriétaire") — ne pas déduire deux fois
  const loyDisponiblePourOwnerStay = Math.max(0, loyTotal - totalDebours - totalHaowner - fraisDeductionLoy)
  const ownerStayAbsorbBranche2 = Math.min(ownerStayMenageTotal, loyDisponiblePourOwnerStay)
  // Cas sans réservation mais avec débours (ex: ménage hors forfait isolé) :
  // virTotal = 0, virementNet peut être négatif = créance DCB à récupérer sur le proprio
  const virementNetBase = virTotal - totalDebours - totalHaowner - fraisDeductionLoy - ownerStayAbsorbBranche2
  const virementNet = (facture?.montant_reversement > 0 &&
                       facture?.statut !== 'brouillon' &&
                       facture?.statut !== 'calcul_en_cours')
    ? facture.montant_reversement
    : (resaIds.length === 0 && extrasGlobaux.length > 0
        ? virementNetBase          // créance négative autorisée (pas de Math.max)
        : Math.max(0, virementNetBase))

  // ── Avis clients ─────────────────────────────────────────────────────────
  const nextMoisStr = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const [{ data: revData }, { data: allReviewsData }] = await Promise.all([
    supabase
      .from('reservation_review')
      .select('id, reviewer_name, rating, comment, submitted_at')
      [isGlobal ? 'in' : 'eq']('bien_id', isGlobal ? maiteIds : bienId)
      .gte('submitted_at', `${mois}-01`)
      .lt('submitted_at', `${nextMoisStr}-01`)
      .order('submitted_at', { ascending: false }),
    supabase
      .from('reservation_review')
      .select('rating')
      [isGlobal ? 'in' : 'eq']('bien_id', isGlobal ? maiteIds : bienId)
      .not('rating', 'is', null),
  ])
  // Dédup : webhook review.created + review.updated peut insérer deux lignes pour le même avis
  // Clé de dédup = (reviewer_name, rating, 100 premiers chars du comment)
  const reviewsSeen = new Set()
  const reviews = (revData || []).filter(r => {
    const key = `${r.reviewer_name}|${r.rating}|${(r.comment || '').substring(0, 100)}`
    if (reviewsSeen.has(key)) return false
    reviewsSeen.add(key)
    return true
  })
  const noteMoisMoy = reviews.length > 0
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : null
  const noteGlobaleMoy = allReviewsData?.length > 0
    ? (allReviewsData.reduce((s, r) => s + (r.rating || 0), 0) / allReviewsData.length).toFixed(1) : null

  // ── KPIs ─────────────────────────────────────────────────────────────────
  // Owner_stay exclus des KPIs hébergement : fin_revenue = ménage proprio (pas CA locatif)
  // et leurs nuits ne sont pas des nuits voyageur
  const resasGuest = resasEnrichies.filter(r => !r.owner_stay)
  const nbResas = resasGuest.length
  const getMgmtFee = (r) => {
    if (!['direct', 'manual'].includes(r.platform)) return 0
    return (r.reservation_fee || [])
      .filter(f => f.fee_type === 'guest_fee' && f.label?.toLowerCase().includes('management'))
      .reduce((s, f) => s + (f.amount || 0), 0)
  }
  const caHeb = resasGuest.reduce((s, r) => s + (r.fin_revenue || 0) - getMgmtFee(r), 0)
  const baseCommTotal = resasGuest.reduce((s, r) => s + (r.base_comm || 0), 0)
  const durees = resasGuest.map(r => r.nights || 0).filter(v => v > 0)
  const nuitsOccupees = durees.reduce((s, v) => s + v, 0)
  const dureeMoy = durees.length ? (durees.reduce((s, v) => s + v, 0) / durees.length).toFixed(1) : '0'
  const tauxOcc = nuitsDispos > 0 ? Math.round((nuitsOccupees / nuitsDispos) * 100) : 0
  // honTotal kpis = somme des r.hon depuis resasEnrichies (via ventByResa)
  // ventByResa déduplique implicitement (last-write-wins par code/resa)
  // → immunisé contre les lignes HON en doublon dans la table ventilation
  // honTotalVent (somme brute toutes lignes) est conservé pour _debug uniquement
  const honTotal  = resasGuest.reduce((s, r) => s + (r.hon || 0), 0)
  const fmenTotal = resasEnrichies.reduce((s, r) => s + (r.fmen || 0), 0)
  const autoTotal = resasEnrichies.reduce((s, r) => s + (ventByResa[r.id]?.AUTO?.montant_ht || 0), 0)

  // RevPAR = virementNet / nuitsDispos
  const revpar = nuitsDispos > 0 && virementNet > 0 ? Math.round(virementNet / nuitsDispos) : null

  // Projection N+1 = moyenne des VIRProprio des 3 mois précédents
  const virByMonth = {}
  for (const v of (virHisto || [])) {
    virByMonth[v.mois_comptable] = (virByMonth[v.mois_comptable] || 0) + (v.montant_ht || 0)
  }
  const virHistoValues = prev3Mois.map(mp => virByMonth[mp] || 0).filter(v => v > 0)
  const projection_revenus = virHistoValues.length > 0
    ? Math.round(virHistoValues.reduce((s, v) => s + v, 0) / virHistoValues.length)
    : null

  const resaN1Valid = resasN1 || []
  const caHebN1 = resaN1Valid.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const nuitesN1 = resaN1Valid.map(r => r.nights || 0).filter(v => v > 0)
  const nuitsOccN1 = nuitesN1.reduce((s, v) => s + v, 0)
  const tauxOccN1 = nuitsDispos > 0 ? Math.round((nuitsOccN1 / nuitsDispos) * 100) : 0

  return {
    resas: resasEnrichies,
    frais: fraisData || [],
    facture,
    tauxCommission,
    extrasGlobaux,
    extrasParResa,
    haownerList,
    ownerStayList,
    ventByResa,
    reviews,
    noteMoisMoy,
    noteGlobaleMoy,
    nbReviewsGlobal: allReviewsData?.length || 0,
    kpis: {
      nbResas, caHeb, baseCommTotal, nuitsOccupees, nuitsDispos,
      tauxOcc, dureeMoy, loyTotal, honTotal, fmenTotal, autoTotal, virementNet,
      modeEncaissement, virTotalProprioEncaisse,
      revpar, projection_revenus,
      // Debug interne
      _virTotal: virTotal, _totalDebours: totalDebours, _totalHaowner: totalHaowner,
      _fraisDeductionLoy: fraisDeductionLoy, _ownerStayMenageTotal: ownerStayMenageTotal,
    },
    kpisN1: {
      nbResas: resaN1Valid.length, caHeb: caHebN1,
      nuitsOccupees: nuitsOccN1, tauxOcc: tauxOccN1,
    },
  }
}
