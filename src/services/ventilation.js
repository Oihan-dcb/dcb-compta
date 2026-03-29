/**
 * Service de calcul de ventilation comptable
 * Transforme les financials Hospitable en lignes comptables DCB
 *
 * Codes ventilation :
 * COM  Ã¢ÂÂ Commission DCB sur les locations directes (Management fee sur CSV HOSP) Ã¢ÂÂ TVA 20%
 * MEN  Ã¢ÂÂ Forfait mÃÂ©nage Brut collectÃÂ© auprÃÂ¨s du voyageur (Cleaning fee + Community fee + Other fee + pet fee + resort fee) Ã¢ÂÂ Hors TVA
 * MGT  Ã¢ÂÂ Management fee rÃÂ©sa directe Ã¢ÂÂ TVA 20%
 * AUTO Ã¢ÂÂ DÃÂ©bours auto-entrepreneur Ã¢ÂÂ Hors TVA
 * HON  Ã¢ÂÂ Honoraires de gestion DCB Ã¢ÂÂ TVA 20%
 * FMEN Ã¢ÂÂ Forfait mÃÂ©nage DCB (MEN - AUTO provisionnÃÂ©e) Ã¢ÂÂ TVA 20%
 * LOY  Ã¢ÂÂ Reversement propriÃÂ©taire Ã¢ÂÂ Hors TVA
 * TAXE Ã¢ÂÂ Taxe de sÃÂ©jour Ã¢ÂÂ Hors TVA
 * DIV  Ã¢ÂÂ Frais divers DCB (expenses [DCB]) Ã¢ÂÂ TVA 20%
 * TAX  Ã¢ÂÂ Taxe de sÃÂ©jour (pass-through) Ã¢ÂÂ Hors TVA, tracÃÂ© uniquement
 * MISC Ã¢ÂÂ Autre mouvements non identifiÃÂ©s (extra guest fee) Ã¢ÂÂ Hors TVA
 */

import { supabase } from '../lib/supabase'

const TVA_RATE = 0.20
const AIRBNB_FEES_RATE = 0.1621  // 16.21% retenu par Airbnb sur cleaning + community fees (validÃÂ© audit mars 2026)

/**
 * Calcule et sauvegarde la ventilation pour toutes les rÃÂ©servations
 * d'un mois donnÃÂ© qui ne sont pas encore ventilÃÂ©es
 *
 * @param {string} mois - YYYY-MM
 */
export async function calculerVentilationMois(mois) {
  // RÃÂ©cupÃÂ©rer les rÃÂ©servations non ventilÃÂ©es du mois
  const { data: reservations, error } = await supabase
    .from('reservation')
    .select(`
      *,
      bien (
        id, proprietaire_id,
        provision_ae_ref, forfait_dcb_ref, has_ae,
        taux_commission_override, gestion_loyer, agence,
        proprietaire (id, taux_commission)
      ),
      reservation_fee (*)
    `)
    .eq('mois_comptable', mois)
    .eq('ventilation_calculee', false)
    .eq('owner_stay', false)       // Ignorer sÃÂ©jours proprio
    // NE PAS exclure les annulÃÂ©es ici Ã¢ÂÂ certaines ont des valeurs (Airbnb/Booking)
    // Le filtre revenue=0 dans calculerVentilationResa gÃÂ¨re les vraies annulÃÂ©es ÃÂ  zÃÂ©ro
    // Les directes annulÃÂ©es sont gÃÂ©rÃÂ©es par early return dans calculerVentilationResa

  if (error) throw error

  let total = 0
  let errors = 0

  for (const resa of (reservations || []).filter(r => r.bien?.gestion_loyer !== false && (r.bien?.agence || 'dcb') === 'dcb')) {
    try {
      await calculerVentilationResa(resa)
      total++
    } catch (err) {
      console.error(`Erreur ventilation résa ${resa.code}:`, err)
      errors++
    }
  }

  return { total, errors }
}

/**
 * AgrÃÂ¨ge les sÃÂ©jours proprio (owner_stay=true) pour affichage sÃÂ©parÃÂ©
 */
export function agregerSejoursProrio(reservations) {
  // RÃÂ¨gle : toute resa owner_stay=true apparaÃÂ®t dans le tableau
  // FMEN = somme des lignes FMEN si ventilÃÂ©e, sinon 0
  const sejours = {}
  for (const resa of reservations) {
    if (!resa.owner_stay) continue
    const propId = resa.bien?.proprietaire_id || 'sans_proprio'
    const propNom = resa.bien?.proprietaire
      ? `${resa.bien.proprietaire.nom}${resa.bien.proprietaire.prenom ? ' ' + resa.bien.proprietaire.prenom : ''}`
      : resa.guest_name || 'Sans propriétaire'
    if (!sejours[propId]) {
      sejours[propId] = { id: propId, nom: propNom, total_fmen: 0, nb_resas: 0, biens: [] }
    }
    const p = sejours[propId]
    p.nb_resas++
    if (resa.bien?.code) p.biens.push(resa.bien.code)
    for (const l of (resa.ventilation || [])) {
      if (l.code === 'FMEN') p.total_fmen += l.montant_ttc
    }
  }
  // Toutes les resas proprio apparaissent, mÃÂªme sans FMEN
  return Object.values(sejours)
}

/**
 * Calcule la ventilation d'une rÃÂ©servation individuelle
 */
export async function calculerVentilationResa(resa) {
  const bien = resa.bien

  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)

  if (bien.gestion_loyer === false) return []  // Proprio gere le loyer
  if ((bien.agence || 'dcb') !== 'dcb') return []  // Bien Lauian - comptabilite separee - pas de ventilation

  // Revenue = montant net reÃÂ§u en banque (en centimes)
  const revenue = resa.fin_revenue || 0
  if (revenue === 0) return // RÃÂ©servation ÃÂ  Ã¢ÂÂ¬0, rien ÃÂ  ventiler

  // --- Extraire les fees ---
  // PrioritÃÂ© : reservation_fee en base (resas importÃÂ©es CSV)
  // Fallback : hospitable_raw.financials.host (resas Booking/Airbnb sans CSV)
  let fees = resa.reservation_fee || []

  if (fees.length === 0 && resa.hospitable_raw?.financials?.host) {
    const fin = resa.hospitable_raw.financials.host
    const rawHostFees = fin.host_fees || []
    const rawGuestFees = fin.guest_fees || []
    const rawTaxes = fin.taxes || []
    fees = [
      ...rawHostFees.map(f => ({ label: f.label, amount: f.amount, fee_type: 'host_fee' })),
      ...rawGuestFees.map(f => ({ label: f.label, amount: f.amount, fee_type: 'guest_fee' })),
      ...rawTaxes.map(f => ({ label: f.label, amount: f.amount, fee_type: 'tax' })),
    ]
  }

  // Host fees (Host Service Fee = nÃÂ©gatif)
  const hostFees = fees.filter(f => f.fee_type === 'host_fee')
  const hostServiceFee = hostFees.reduce((s, f) => s + (f.amount || 0), 0)

  // Guest fees = tout ce que le voyageur paie en plus des nuitÃÂ©es (mÃÂ©nage, community, management, etc.)
  const guestFeesAll = fees.filter(f => f.fee_type === 'guest_fee')
  const totalGuestFees = guestFeesAll.reduce((s, f) => s + (f.amount || 0), 0)

  // Pour compatibilitÃÂ© (AE utilise toujours le community fee comme provision)
  const communityFee = guestFeesAll.find(f => f.label?.toLowerCase().includes('community'))

  // Taxes pass-through
  const taxes = fees.filter(f => f.fee_type === 'tax')
  
  // Adjustments et discounts
  const adjustments = fees.filter(f => f.fee_type === 'adjustment')
  const adjustmentsTotal = adjustments.reduce((s, f) => s + (f.amount || 0), 0)

  // Remises promotionnelles (Promotion Discount, Last Minute Discount, Ad-hoc fee...)
  // Tableau sÃÂ©parÃÂ© dans hospitable_raw.financials.host.discounts (nÃÂ©gatifs)
  const discountsRaw = resa.hospitable_raw?.financials?.host?.discounts || []
  const discountsTotal = discountsRaw.reduce((s, d) => s + (d.amount || 0), 0)

  // Accommodation de base (nuitÃÂ©es seules, en centimes)
  const accommodation = resa.fin_accommodation || 0

  // Taux Ã¢ÂÂ prioritÃÂ© : override par bien > proprio > dÃÂ©faut 25%
  const tauxCom = bien.taux_commission_override
    || (bien.proprietaire?.taux_commission ? bien.proprietaire.taux_commission / 100 : null)
    || 0.25

  const tauxCalcule = tauxCom // taux configurÃÂ©
// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  // FORMULE DCB :
  //   Base commissionable = revenue - mgmt_fee_brut - cleaning_fee_brut - taxes
  //   HON  = base ÃÂ taux (TVA 20%)
  //   LOY  = base - HON
  //   FMEN = cleaning_fee_corrigÃÂ© - AUTO  (corrigÃÂ© = /1,0077 pour directes)
  //   AUTO = provision AE (hors TVA)
  //   TAXE = taxe de sÃÂ©jour (hors TVA)
  //
  //   /1,0077 uniquement sur FMEN pour les rÃÂ©servations DIRECTES
  //   (Hospitable prend 0,77% sur les fees directs Ã¢ÂÂ pas Airbnb, Booking, manual)
  // Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

  const isDirect = resa.platform === 'direct'
  const isCancelled = resa.final_status === 'cancelled'

  // RÃÂ©servation directe annulÃÂ©e Ã¢ÂÂ pas de ventilation (zÃÂ©ro virement)
  if (isDirect && isCancelled) {
    await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
    await supabase.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return []
  }

  // Fees depuis Hospitable
  // Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  // STRUCTURE RÃÂELLE DES FEES HOSPITABLE (confirmÃÂ©e sur statement 602 fÃÂ©v 2026) :
  //
  // AIRBNB :
  //   "Cleaning fee"   = frais mÃÂ©nage facturÃÂ©s au voyageur
  //   "Community fee"  = commission Airbnb sur l'hÃÂ©bergement (PAS le mÃÂ©nage)
  //   "Host Service Fee" = dÃÂ©duction (nÃÂ©gatif)
  //   Ã¢ÂÂ FMEN basÃÂ© sur "Cleaning fee" uniquement
  //   Ã¢ÂÂ Airbnb prend 13,95% sur le "Cleaning fee"
  //
  // DIRECT (Hospitable) :
  //   "Management fee" = frais de gestion
  //   "Community fee"  = frais mÃÂ©nage (convention Hospitable pour les directes)
  //   "Host Service Fee" = -0,77% sur tous les fees (cleaning+mgmt+community)
  //   Ã¢ÂÂ FMEN basÃÂ© sur "Community fee" (= mÃÂ©nage direct)
  //   Ã¢ÂÂ Hospitable prend 0,77% sur (Community fee + Management fee)
  // Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

  const managementFeeRaw = (guestFeesAll.find(f => f.label?.toLowerCase().includes('management'))?.amount || 0)

  // Cleaning fee (Airbnb) = label "Cleaning fee" uniquement
  const cleaningFeeAirbnb = (guestFeesAll.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0)

  // Community fee = label "Community fee"
  // Pour Airbnb : commission hÃÂ©bergement (pas le mÃÂ©nage)
  // Pour Direct : frais mÃÂ©nage
  const communityFeeRaw = (guestFeesAll.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0)

  // MÃÂ©nage brut selon la plateforme
  const menageBrut = resa.platform === 'airbnb' ? cleaningFeeAirbnb : communityFeeRaw

  // AUTO = provision AE (hors TVA)
  // Pour les rÃÂ©servations annulÃÂ©es non-directes (Airbnb/Booking avec frais) : pas de provision AE
  const aeAmount = isCancelled ? 0 : (bien.provision_ae_ref || 0)

  // Taxes pass-through - Airbnb ET Booking reversent certaines taxes directement (Remitted)
  const isRemitted = t => t.label?.toLowerCase().includes('remitted')
  const taxesTotal = (resa.platform === 'airbnb') ? 0 : taxes.filter(t => !isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)

  // Ã¢ÂÂÃ¢ÂÂ Taux commission plateforme sur les fees Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  // Airbnb  : 16,21% sur (cleaning fee + community fee / host service fee)
  //           VÃÂ©rifiÃÂ© sur statement 602 Horizonte fÃÂ©v 2026 ligne par ligne
  // Booking : ÃÂ  vÃÂ©rifier sur statement rÃÂ©el
  // Direct  : 0,77% sur (cleaning + management) via /1.0077
  const PLATFORM_CLEANING_RATES = { airbnb: 0.1621, booking: 0.1517 }  // Booking ~15,17% mesurÃÂ© statement Chambre Txomin fÃÂ©v 2026

  let commissionableBase, loyAmount, cleaningFeeNet, platformRateOnCleaning

  if (isDirect) {
    // Ã¢ÂÂÃ¢ÂÂ DIRECTE Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
    // communityFeeRaw = mÃÂ©nage pour les directes (label "Community fee" Hospitable)
    // managementFeeRaw = frais gestion
    // Hospitable prend 0,77% sur (communityFeeRaw + managementFeeRaw)
    // Base = revenue - TOUS les fees mÃÂ©nage (cleaning + community + management) - taxes
    commissionableBase = revenue - cleaningFeeAirbnb - communityFeeRaw - managementFeeRaw - taxesTotal - adjustmentsTotal + discountsTotal
    const feesDirectBruts = cleaningFeeAirbnb + communityFeeRaw + managementFeeRaw
    // Math.floor pour platformRemb exact (arrondi supÃÂ©rieur sur la retenue)
    const feesDirectNets = feesDirectBruts > 0 ? Math.floor(feesDirectBruts / 1.0077) : 0
    // MÃÂ©nage net = total net - management = part mÃÂ©nage aprÃÂ¨s dÃÂ©duction commission Hospitable
    cleaningFeeNet = bien.forfait_dcb_ref || Math.max(0, feesDirectNets - managementFeeRaw)
    platformRateOnCleaning = 0
  } else {
    // Ã¢ÂÂÃ¢ÂÂ AIRBNB / BOOKING / AUTRES Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
    // Pour Airbnb : menageBrut = cleaningFeeAirbnb (label "Cleaning fee")
    // communityFeeRaw = commission Airbnb sur hÃÂ©bergement (pas utilisÃÂ© pour FMEN)
    commissionableBase = accommodation + hostServiceFee + discountsTotal
    // FMEN basÃÂ© sur le mÃÂ©nage rÃÂ©el (cleaningFeeAirbnb pour Airbnb)
    cleaningFeeNet = bien.forfait_dcb_ref || menageBrut
    platformRateOnCleaning = PLATFORM_CLEANING_RATES[resa.platform] || PLATFORM_CLEANING_RATES.airbnb
  }

  // HON = base ÃÂ taux (TVA 20%)
  // Direct : Math.floor pour correspondre exactement au statement Hospitable
  const honTTC = isDirect ? Math.floor(commissionableBase * tauxCom) : Math.round(commissionableBase * tauxCom)
  const honHT  = Math.round(honTTC / (1 + TVA_RATE))

  // Part plateforme retenue sur les fees (ÃÂ©criture comptable cÃÂ´tÃÂ© owner dans statement)
  // Airbnb : 16,21% ÃÂ (cleaning fee + community fee) Ã¢ÂÂ vÃÂ©rifiÃÂ© sur statement rÃÂ©el
  // Booking : taux ÃÂ mÃÂ©nage brut
  // Direct : 0,77% ÃÂ (cleaning + mgmt) Ã¢ÂÂ mÃÂªme logique, remboursÃÂ© au proprio via LOY
  let platformRembourseMenage
  if (isDirect) {
    // Pour les directes : le remboursement 0,77% s'applique sur TOUS les fees
    // (cleaning + community + management) Ã¢ÂÂ vÃÂ©rifiÃÂ© sur statement HOST-3QKPIK
    const feesDirectBruts2 = cleaningFeeAirbnb + communityFeeRaw + managementFeeRaw
    const feesDirectNets2 = feesDirectBruts2 > 0 ? Math.round(feesDirectBruts2 / 1.0077) : 0
    platformRembourseMenage = feesDirectBruts2 - feesDirectNets2
  } else {
    // Airbnb : 13,95% sur (cleaning + community) Ã¢ÂÂ mÃÂªme taux que dueToOwner
    // Booking et autres : taux spÃÂ©cifique plateforme sur mÃÂ©nage brut
    const feesBaseForPlatform = (resa.platform === 'airbnb')
      ? (cleaningFeeAirbnb + communityFeeRaw)
      : menageBrut
    const rateForPlatform = (resa.platform === 'airbnb') ? AIRBNB_FEES_RATE : platformRateOnCleaning
    platformRembourseMenage = (resa.platform === 'airbnb')
      ? Math.ceil(rateForPlatform * feesBaseForPlatform)
      : Math.round(rateForPlatform * feesBaseForPlatform)
  }

  // LOY = base - HON + remboursement plateforme (mÃÂªme logique direct et plateforme)
  loyAmount = commissionableBase - honTTC + platformRembourseMenage

  // FMEN = fees_mÃÂ©nage_brut - AUTO (TVA 20%)
  // RÃÂGLE : platform_remb est une ÃÂ©criture comptable cÃÂ´tÃÂ© owner Ã¢ÂÂ LOY uniquement, PAS dans FMEN
  // Airbnb  : fees_mÃÂ©nage = cleaning_fee + community_fee (host service fee)
  // Direct  : fees_mÃÂ©nage = cleaning_fee + community_fee (management_fee = expense sÃÂ©parÃÂ© Ã¢ÂÂ AUTO)
  // VÃÂ©rifiÃÂ© ligne par ligne sur statement 602 "Horizonte" fÃÂ©v 2026
  const fmenBase = cleaningFeeAirbnb + communityFeeRaw  // = MEN brut (fees mÃÂ©nage voyageur)
  // dueToOwner : part plateforme sur fees mÃÂ©nage (Airbnb 13,95%, Booking 15,17%)
  const dueToOwner = (resa.platform === 'airbnb')
    ? Math.round(fmenBase * AIRBNB_FEES_RATE)
    : (resa.platform === 'booking')
      ? Math.round(fmenBase * PLATFORM_CLEANING_RATES.booking)
      : 0
  const fmenTTC = Math.max(0, fmenBase - dueToOwner - aeAmount)
  const fmenHT  = fmenTTC > 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // Ã¢ÂÂÃ¢ÂÂ MEN : mÃÂ©nage brut collectÃÂ© voyageur (toutes guest fees sauf management) Ã¢ÂÂ Hors TVA
  const menLabelsToExclude = ['management fee', 'host service fee']
  const menFees = guestFeesAll.filter(f => !menLabelsToExclude.includes(f.label?.toLowerCase()))
  const menAmount = menFees.reduce((s, f) => s + (f.amount || 0), 0)

  // Ã¢ÂÂÃ¢ÂÂ COM : commission DCB sur locations directes (Management fee brut) Ã¢ÂÂ TVA 20%
  const comAmount = isDirect ? managementFeeRaw : 0
  const comHT = comAmount > 0 ? Math.round(comAmount / (1 + TVA_RATE)) : 0

  // LOY Booking : recalcul depuis fin_revenue (taux Booking variable sur cleaning)
  if (resa.platform === 'booking') {
    // fin_revenue Hospitable inclut les Remitted taxes Ã¢ÂÂ dÃÂ©duire pour avoir le net statement
    const remittedTotal = taxes.filter(t => isRemitted(t)).reduce((s,t) => s + (t.amount||0), 0)
    const finRevenueNet = (resa.fin_revenue || 0) - remittedTotal
    loyAmount = finRevenueNet - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  // --- Lignes de ventilation ---
  const lignes = []

  // MEN Ã¢ÂÂ mÃÂ©nage brut collectÃÂ© voyageur (Hors TVA)
  if (menAmount > 0) {
    lignes.push(ligneHorsTVA('MEN', 'Ménage brut voyageur', menAmount, bien, resa))
  }

  // COM Ã¢ÂÂ commission DCB sur locations directes (Management fee, TVA 20%)
  if (comHT > 0) {
    lignes.push(ligneTVA('COM', 'Commission DCB', comHT, bien, resa, null, comAmount))
  }

  // HON Ã¢ÂÂ honoraires de gestion (TVA 20%)
  if (honHT > 0) {
    lignes.push(ligneTVA('HON', 'Honoraires de gestion', honHT, bien, resa, tauxCalcule, honTTC))
  }

  // FMEN Ã¢ÂÂ forfait mÃÂ©nage DCB = cleaning fee - AUTO (TVA 20%)
  if (fmenHT > 0) {
    lignes.push(ligneTVA('FMEN', 'Forfait ménage', fmenHT, bien, resa, null, fmenTTC))
  }

  // AUTO Ã¢ÂÂ dÃÂ©bours auto-entrepreneur (hors TVA)
  if (aeAmount > 0) {
    lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', aeAmount, bien, resa))
  }


  // LOY Ã¢ÂÂ reversement propriÃÂ©taire (hors TVA)
  if (loyAmount > 0) {
    lignes.push(ligneHorsTVA('LOY', 'Reversement propriétaire', loyAmount, bien, resa))
  }

  // VIR Ã¢ÂÂ virement propriÃÂ©taire
  // Direct  : LOY + TAXE + 0,77% ÃÂ (mgmt_fee + cleaning_fee) [Hospitable rembourse sa commission]
  // Airbnb  : LOY + TAXE  [pas de remboursement]
  // Pour les directes : Hospitable prend 0,77% sur (management + community/mÃÂ©nage)
  // VIR direct = LOY + taxes (remboursement 0,77% Hospitable dÃÂ©jÃÂ  dans platformRemb Ã¢ÂÂ LOY)
  const virAmount = loyAmount + taxesTotal
  if (virAmount > 0) {
    lignes.push(ligneHorsTVA('VIR', 'Virement propriétaire', virAmount, bien, resa))
  }

  // TAXE Ã¢ÂÂ Airbnb: exclue. Booking: pass-through seulement. Direct: toutes.
  if (resa.platform !== 'airbnb') {
    for (const tax of taxes) {
      if (tax.amount > 0 && !isRemitted(tax)) {
        lignes.push(ligneHorsTVA('TAXE', tax.label || 'Taxe séjour', tax.amount, bien, resa))
      }
    }
  }

  // Supprimer les ventilations existantes pour cette rÃÂ©sa
  await supabase.from('ventilation').delete().eq('reservation_id', resa.id)

  // InsÃÂ©rer les nouvelles lignes
  if (lignes.length > 0) {
    const { error } = await supabase.from('ventilation').insert(lignes)
    if (error) throw error
  }

  // Marquer la rÃÂ©sa comme ventilÃÂ©e
  await supabase
    .from('reservation')
    .update({ ventilation_calculee: true })
    .eq('id', resa.id)

  // CF-PAE3 : relier mission_menage.ventilation_auto_id Ã  la ligne AUTO
  const { data: ligneAuto } = await supabase
    .from('ventilation')
    .select('id')
    .eq('reservation_id', resa.id)
    .eq('code', 'AUTO')
    .single()
  if (ligneAuto?.id) {
    // RPC SECURITY DEFINER — contourne RLS ae_update_own_missions
    await supabase.rpc('lier_ventilation_auto_mission', {
      p_reservation_id: resa.id,
      p_ventilation_id: ligneAuto.id,
    })
  }
}

// --- Helpers ---

function ligneTVA(code, libelle, montantHT, bien, resa, tauxCalcule, montantTTC) {
  // CONTRAT STRICT :
  // montantHT  = montant HORS TAXE (ex: 226,04 Ã¢ÂÂ¬ = comTTC/1.20)
  // montantTTC = montant TTC (ex: 271,25 Ã¢ÂÂ¬ = base ÃÂ taux)
  // TVA        = montantTTC - montantHT (ex: 45,21 Ã¢ÂÂ¬)
  // Ne JAMAIS passer comTTC comme montantHT Ã¢ÂÂ c'est l'erreur historique corrigÃÂ©e
  const ttc = montantTTC || Math.round(montantHT * (1 + TVA_RATE))
  const tva = ttc - montantHT
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code,
    libelle,
    montant_ht: montantHT,
    taux_tva: 20,
    montant_tva: tva,
    montant_ttc: ttc,
    mois_comptable: resa.mois_comptable,
    calcul_source: 'auto',
    taux_calcule: code === 'HON' ? tauxCalcule : null,
  }
}

function ligneHorsTVA(code, libelle, montant, bien, resa) {
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code,
    libelle,
    montant_ht: montant,
    taux_tva: 0,
    montant_tva: 0,
    montant_ttc: montant,
    mois_comptable: resa.mois_comptable,
    calcul_source: 'auto',
  }
}

/**
 * RÃÂ©cupÃÂ¨re la ventilation d'un mois, groupÃÂ©e par propriÃÂ©taire
 */
export async function getVentilationMois(mois) {
  const { data, error } = await supabase
    .from('ventilation')
    .select(`
      *,
      reservation (code, platform, arrival_date, departure_date, nights, guest_name),
      bien (hospitable_name, code),
      proprietaire (id, nom, prenom)
    `)
    .eq('mois_comptable', mois)
    .order('code')

  if (error) throw error
  return data || []
}

/**
 * RÃÂ©capitulatif de ventilation par code pour un mois
 */
export async function getRecapVentilation(mois) {
  const lignes = await getVentilationMois(mois)

  // RÃÂ©cap global par code
  const recap = {}
  for (const l of lignes) {
    if (!recap[l.code]) {
      recap[l.code] = { code: l.code, libelle: l.libelle, ht: 0, tva: 0, ttc: 0, nb: 0 }
    }
    recap[l.code].ht += l.montant_ht
    recap[l.code].tva += l.montant_tva
    recap[l.code].ttc += l.montant_ttc
    recap[l.code].nb++
  }

  // RÃÂ©cap par propriÃÂ©taire
  const parProprio = {}
  for (const l of lignes) {
    const propId = l.proprietaire_id || 'sans_proprio'
    const propNom = l.proprietaire ? `${l.proprietaire.prenom || ''} ${l.proprietaire.nom || ''}`.trim() : 'Sans propriétaire'
    if (!parProprio[propId]) {
      parProprio[propId] = { id: propId, nom: propNom, codes: {}, total_com: 0, total_men: 0, total_loy: 0, total_auto: 0, total_vir: 0 }
    }
    const p = parProprio[propId]
    if (!p.codes[l.code]) p.codes[l.code] = { ht: 0, ttc: 0, nb: 0 }
    p.codes[l.code].ht += l.montant_ht
    p.codes[l.code].ttc += l.montant_ttc
    p.codes[l.code].nb++
    if (l.code === 'HON') p.total_com += l.montant_ttc  // TTC (TVA 20% incluse)
    if (l.code === 'FMEN') p.total_men += l.montant_ttc // TTC (TVA 20% incluse)
    if (l.code === 'LOY') p.total_loy += l.montant_ht   // HT = TTC (hors TVA)
    if (l.code === 'AUTO') p.total_auto += l.montant_ht // HT = TTC (hors TVA)
    if (l.code === 'VIR') p.total_vir += l.montant_ttc  // HT = TTC (hors TVA)
  }

  return {
    parCode: Object.values(recap),
    parProprio: Object.values(parProprio).sort((a, b) => a.nom.localeCompare(b.nom)),
    lignes,
  }
}
