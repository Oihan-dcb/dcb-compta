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

  // ── Requêtes parallèles ──────────────────────────────────────────────────
  const [
    { data: resas, error: resasErr },
    { data: resasN1 },
    { data: fraisData },
    { data: facture },
    tauxCommission,
  ] = await Promise.all([
    // 1. Réservations avec reservation_fee pour gross_revenue exact
    (() => {
      let q = supabase
        .from('reservation')
        .select('id, code, fin_revenue, fin_accommodation, fin_host_service_fee, fin_gross_revenue, nights, arrival_date, departure_date, final_status, platform, owner_stay, guest_name, bien:bien_id(hospitable_name, code), reservation_fee(fee_type, amount)')
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
      .select('taux_commission_override, proprietaire:proprietaire_id(taux_commission)')
      .eq('id', bienId)
      .maybeSingle()
      .then(r => r.data?.taux_commission_override || r.data?.proprietaire?.taux_commission || 25),
  ])

  if (resasErr) throw new Error(resasErr.message)

  const resasValides = (resas || []).filter(r =>
    !STATUTS_NON_VENTILABLES.includes(r.final_status) || (r.fin_revenue || 0) > 0
  )
  const resaIds = resasValides.map(r => r.id)

  // ── Ventilation ──────────────────────────────────────────────────────────
  let loyTotal = 0, honTotalVent = 0, virTotal = 0
  let ventByResa = {}
  if (resaIds.length) {
    const { data: ventsData } = await supabase
      .from('ventilation')
      .select('reservation_id, code, montant_ht, montant_ttc')
      .in('reservation_id', resaIds)
      .in('code', ['HON', 'LOY', 'VIR', 'FMEN', 'AUTO', 'MEN'])
    const vents = ventsData || []
    for (const v of vents) {
      if (!ventByResa[v.reservation_id]) ventByResa[v.reservation_id] = {}
      ventByResa[v.reservation_id][v.code] = v
    }
    loyTotal     = vents.filter(v => v.code === 'LOY').reduce((s, v) => s + (v.montant_ht  || 0), 0)
    honTotalVent = vents.filter(v => v.code === 'HON').reduce((s, v) => s + (v.montant_ttc || 0), 0)
    virTotal     = vents.filter(v => v.code === 'VIR').reduce((s, v) => s + (v.montant_ht  || 0), 0)
  }

  // ── Prestations hors forfait ─────────────────────────────────────────────
  let prestations = []
  try {
    let q = supabase
      .from('prestation_hors_forfait')
      .select('id, bien_id, reservation_id, date_prestation, description, montant, type_imputation, prestation_type:prestation_type_id(nom)')
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
      extraByResa[p.reservation_id] = (extraByResa[p.reservation_id] || 0) + (p.montant || 0)
      extrasParResa.push({ ...p, libelle: p.description || p.prestation_type?.nom || '—' })
    })

  const extrasGlobaux = (prestations || [])
    .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation) && !p.reservation_id)
    .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
    .map(p => ({ ...p, libelle: p.description || p.prestation_type?.nom || '—' }))

  const haownerList = (prestations || [])
    .filter(p => p.type_imputation === 'haowner')
    .sort((a, b) => (a.date_prestation || '').localeCompare(b.date_prestation || ''))
    .map(p => ({ ...p, montant_ttc: Math.round((p.montant || 0) * 1.20), libelle: p.description || p.prestation_type?.nom || '—' }))

  const totalDebours = (prestations || [])
    .filter(p => ['deduction_loy', 'debours_proprio'].includes(p.type_imputation))
    .reduce((s, p) => s + (p.montant || 0), 0)
  const totalHaowner = haownerList.reduce((s, p) => s + (p.montant_ttc || 0), 0)

  // ── Enrichissement par réservation ───────────────────────────────────────
  const resasEnrichies = resasValides.map(r => {
    const v = ventByResa[r.id] || {}
    const virHt = v.VIR?.montant_ht || 0
    const loyHt = v.LOY?.montant_ht || 0
    return {
      ...r,
      vent: v,
      extra: extraByResa[r.id] || 0,
      // gross_revenue = total_price CSV (montant total payé par le voyageur, source directe)
      // Fallback : fin_accommodation + guest_fees pour les resas importées avant la migration
      gross_revenue: (r.platform === 'direct' && r.fin_gross_revenue)
        ? r.fin_gross_revenue
        : ((r.fin_accommodation || 0) +
          (r.reservation_fee || []).filter(f => f.fee_type === 'guest_fee').reduce((s, f) => s + (f.amount || 0), 0)),
      // base_comm = fin_accommodation + fin_host_service_fee
      // = "Commissionable base" Hospitable (net de la commission hôte Airbnb/Booking/Direct)
      // fin_host_service_fee est négatif (commission retenue par la plateforme)
      base_comm: (r.fin_accommodation || 0) + (r.fin_host_service_fee || 0),
      hon:  v.HON?.montant_ttc || 0,
      loy:  loyHt,
      vir:  virHt,
      fmen: v.FMEN?.montant_ttc || 0,
      taxe: Math.max(0, virHt - loyHt),
      menage_voyageur: (v.FMEN?.montant_ttc || 0) + (v.AUTO?.montant_ht || 0),
    }
  })

  // ── Owner stay ménage ────────────────────────────────────────────────────
  // ownerStayList : une ligne par résa proprio (pour affichage dans charges)
  const ownerStayList = resasEnrichies
    .filter(r => r.owner_stay && r.platform === 'manual')
    .map(r => ({
      id: r.id,
      arrival_date: r.arrival_date,
      libelle: 'Ménage séjour propriétaire',
      montant: (r.fmen || 0) + (ventByResa[r.id]?.AUTO?.montant_ht || 0),
    }))
    .filter(r => r.montant > 0)
  const ownerStayMenageTotal = ownerStayList.reduce((s, r) => s + r.montant, 0)

  // ── fraisDeductionLoy — règle unique ─────────────────────────────────────
  const fraisDeductionLoy = (fraisData || [])
    .filter(f => f.mode_traitement === 'deduire_loyer')
    .reduce((s, f) => {
      if (f.statut === 'facture' && f.statut_deduction !== 'en_attente') return s + (f.montant_deduit_loy || 0)
      if (f.statut === 'facture' && f.statut_deduction === 'en_attente')  return s + (f.montant_ttc || 0)
      if (f.statut === 'a_facturer')                                       return s + (f.montant_ttc || 0)
      return s
    }, 0)

  // ── virementNet — règle unique ───────────────────────────────────────────
  // BRANCHE 1 : facture confirmée (hors brouillon/calcul_en_cours) → montant_reversement est la vérité
  // BRANCHE 2 : recalcul depuis virTotal
  const virementNet = (facture?.montant_reversement > 0 &&
                       facture?.statut !== 'brouillon' &&
                       facture?.statut !== 'calcul_en_cours')
    ? facture.montant_reversement
    : Math.max(0, virTotal - totalDebours - totalHaowner - fraisDeductionLoy - ownerStayMenageTotal)

  // ── Avis clients ─────────────────────────────────────────────────────────
  const nextMoisStr = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const [{ data: revData }, { data: allReviewsData }] = await Promise.all([
    supabase
      .from('reservation_review')
      .select('id, reviewer_name, rating, comment, submitted_at')
      .eq('bien_id', bienId)
      .gte('submitted_at', `${mois}-01`)
      .lt('submitted_at', `${nextMoisStr}-01`)
      .order('submitted_at', { ascending: false }),
    supabase
      .from('reservation_review')
      .select('rating')
      .eq('bien_id', bienId)
      .not('rating', 'is', null),
  ])
  const reviews = revData || []
  const noteMoisMoy = reviews.length > 0
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : null
  const noteGlobaleMoy = allReviewsData?.length > 0
    ? (allReviewsData.reduce((s, r) => s + (r.rating || 0), 0) / allReviewsData.length).toFixed(1) : null

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const nbResas = resasEnrichies.length
  const caHeb = resasEnrichies.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const baseCommTotal = resasEnrichies.reduce((s, r) => s + (r.base_comm || 0), 0)
  const durees = resasEnrichies.map(r => r.nights || 0).filter(v => v > 0)
  const nuitsOccupees = durees.reduce((s, v) => s + v, 0)
  const dureeMoy = durees.length ? (durees.reduce((s, v) => s + v, 0) / durees.length).toFixed(1) : '0'
  const tauxOcc = nuitsDispos > 0 ? Math.round((nuitsOccupees / nuitsDispos) * 100) : 0
  // honTotal kpis = facture.total_ttc si facture présente (montant réel facturé)
  const honTotal = facture?.total_ttc || honTotalVent

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
      tauxOcc, dureeMoy, loyTotal, honTotal, virementNet,
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
