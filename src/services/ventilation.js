/**
 * Service de calcul de ventilation comptable
 * Transforme les financials Hospitable en lignes comptables DCB
 *
 * Codes ventilation :
 * COM  — Commission DCB sur les locations directes (Management fee sur CSV HOSP) — TVA 20%
 * MEN  — Forfait ménage Brut collecté auprès du voyageur (Cleaning fee + Community fee + Other fee + pet fee + resort fee) — Hors TVA
 * MGT  — Management fee résa directe — TVA 20%
 * AUTO — Débours auto-entrepreneur — Hors TVA
 * HON  — Honoraires de gestion DCB — TVA 20%
 * FMEN — Forfait ménage DCB (MEN - AUTO provisionnée) — TVA 20%
 * LOY  — Reversement propriétaire — Hors TVA
 * TAXE — Taxe de séjour — Hors TVA
 * DIV  — Frais divers DCB (expenses [DCB]) — TVA 20%
 * TAX  — Taxe de séjour (pass-through) — Hors TVA, tracé uniquement
 * MISC — Autre mouvements non identifiés (extra guest fee) — Hors TVA
 */

import { supabase } from '../lib/supabase'
import { logOp } from './journal'

const TVA_RATE = 0.20
const AIRBNB_FEES_RATE = 0.1621  // 16.21% retenu par Airbnb sur cleaning + community fees (validé audit mars 2026)

/**
 * Calcule et sauvegarde la ventilation pour toutes les réservations
 * d'un mois donné qui ne sont pas encore ventilées
 *
 * @param {string} mois - YYYY-MM
 */
export async function calculerVentilationMois(mois) {
  // Récupérer les réservations non ventilées du mois
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
    .neq('final_status', 'cancelled')
    .eq('owner_stay', false)

  if (error) throw error

  let total = 0
  let errors = 0

  for (const resa of (reservations || []).filter(r => r.bien?.gestion_loyer !== false && (r.bien?.agence || 'dcb') === 'dcb')) {
    try {
      await calculerVentilationResa(resa)
      total++
    } catch (err) {
      console.error('[VENTIL ERROR]', resa.code, resa.hospitable_id, err.message)
      errors++
    }
  }

  logOp({
    categorie: 'ventilation', action: 'compute', mois_comptable: mois,
    statut: errors > 0 ? 'warning' : 'ok', source: 'app',
    message: `Ventilation ${mois} : ${total} résa(s) calculée(s)${errors > 0 ? ', ' + errors + ' erreur(s)' : ''}`,
    meta: { total, errors },
  }).catch(() => {})
  return { total, errors }
}

/**
 * Agrège les séjours proprio (owner_stay=true) pour affichage séparé
 */
export function agregerSejoursProrio(reservations) {
  // Règle : toute resa owner_stay=true apparaît dans le tableau
  // FMEN = somme des lignes FMEN si ventilée, sinon 0
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
  // Toutes les resas proprio apparaissent, même sans FMEN
  return Object.values(sejours)
}

/**
 * Calcule la ventilation d'une réservation individuelle
 */
export async function calculerVentilationResa(resa) {
  const bien = resa.bien

  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)

  if (bien.gestion_loyer === false) return []  // Proprio gere le loyer
  if ((bien.agence || 'dcb') !== 'dcb') return []  // Bien Lauian - comptabilite separee - pas de ventilation

  // Revenue = montant net reçu en banque (en centimes)
  const revenue = resa.fin_revenue || 0
  if (revenue === 0) {
    await supabase.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return
  }

  // --- Extraire les fees ---
  // Priorité : reservation_fee en base (resas importées CSV)
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

  // Host fees (Host Service Fee = négatif)
  const hostFees = fees.filter(f => f.fee_type === 'host_fee')
  const hostServiceFee = hostFees.reduce((s, f) => s + (f.amount || 0), 0)

  // Guest fees = tout ce que le voyageur paie en plus des nuitées (ménage, community, management, etc.)
  const guestFeesAll = fees.filter(f => f.fee_type === 'guest_fee')
  const totalGuestFees = guestFeesAll.reduce((s, f) => s + (f.amount || 0), 0)

  // Pour compatibilité (AE utilise toujours le community fee comme provision)
  const communityFee = guestFeesAll.find(f => f.label?.toLowerCase().includes('community'))

  // Taxes pass-through
  const taxes = fees.filter(f => f.fee_type === 'tax')
  
  // Adjustments et discounts
  const adjustments = fees.filter(f => f.fee_type === 'adjustment')
  const adjustmentsTotal = adjustments.reduce((s, f) => s + (f.amount || 0), 0)

  // Remises promotionnelles (Promotion Discount, Last Minute Discount, Ad-hoc fee...)
  // Tableau séparé dans hospitable_raw.financials.host.discounts (négatifs)
  const discountsRaw = resa.hospitable_raw?.financials?.host?.discounts || []
  const discountsTotal = discountsRaw.reduce((s, d) => s + (d.amount || 0), 0)

  // Accommodation de base (nuitées seules, en centimes)
  const accommodation = resa.fin_accommodation || 0

  // Taux — priorité : override par bien > proprio > défaut 25%
  const tauxCom = bien.taux_commission_override
    || (bien.proprietaire?.taux_commission ? bien.proprietaire.taux_commission / 100 : null)
    || 0.25

  const tauxCalcule = tauxCom // taux configuré
// ─────────────────────────────────────────────────────────────────────────
  // FORMULE DCB :
  //   Base commissionable = revenue - mgmt_fee_brut - cleaning_fee_brut - taxes
  //   HON  = base × taux (TVA 20%)
  //   LOY  = base - HON
  //   FMEN = cleaning_fee_corrigé - AUTO  (corrigé = /1,0077 pour directes)
  //   AUTO = provision AE (hors TVA)
  //   TAXE = taxe de séjour (hors TVA)
  //
  //   /1,0077 uniquement sur FMEN pour les réservations DIRECTES
  //   (Hospitable prend 0,77% sur les fees directs — pas Airbnb, Booking, manual)
  // ─────────────────────────────────────────────────────────────────────────

  const isDirect = resa.platform === 'direct'
  const isCancelled = resa.final_status === 'cancelled'

  // Réservation directe annulée → pas de ventilation (zéro virement)
  if (isDirect && isCancelled) {
    await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
    await supabase.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return []
  }

  // Fees depuis Hospitable
  // ─────────────────────────────────────────────────────────────────────────
  // STRUCTURE RÉELLE DES FEES HOSPITABLE (confirmée sur statement 602 fév 2026) :
  //
  // AIRBNB :
  //   "Cleaning fee"   = frais ménage facturés au voyageur
  //   "Community fee"  = commission Airbnb sur l'hébergement (PAS le ménage)
  //   "Host Service Fee" = déduction (négatif)
  //   → FMEN basé sur "Cleaning fee" uniquement
  //   → Airbnb prend 13,95% sur le "Cleaning fee"
  //
  // DIRECT (Hospitable) :
  //   "Management fee" = frais de gestion
  //   "Community fee"  = frais ménage (convention Hospitable pour les directes)
  //   "Host Service Fee" = -0,77% sur tous les fees (cleaning+mgmt+community)
  //   → FMEN basé sur "Community fee" (= ménage direct)
  //   → Hospitable prend 0,77% sur (Community fee + Management fee)
  // ─────────────────────────────────────────────────────────────────────────

  const managementFeeRaw = (guestFeesAll.find(f => f.label?.toLowerCase().includes('management'))?.amount || 0)

  // Cleaning fee (Airbnb) = label "Cleaning fee" uniquement
  const cleaningFeeAirbnb = (guestFeesAll.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0)

  // Community fee = label "Community fee"
  // Pour Airbnb : commission hébergement (pas le ménage)
  // Pour Direct : frais ménage
  const communityFeeRaw = (guestFeesAll.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0)

  // Ménage brut selon la plateforme
  const menageBrut = resa.platform === 'airbnb' ? cleaningFeeAirbnb : communityFeeRaw

  // AUTO = provision AE (hors TVA)
  // Pour les réservations annulées non-directes (Airbnb/Booking avec frais) : pas de provision AE
  const aeAmount = isCancelled ? 0 : (bien.provision_ae_ref || 0)

  // Taxes pass-through - Airbnb ET Booking reversent certaines taxes directement (Remitted)
  const isRemitted = t => t.label?.toLowerCase().includes('remitted')
  const taxesTotal = (resa.platform === 'airbnb') ? 0 : taxes.filter(t => !isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)

  // ── Taux commission plateforme sur les fees ───────────────────────────────
  // Airbnb  : 16,21% sur (cleaning fee + community fee / host service fee)
  //           Vérifié sur statement 602 Horizonte fév 2026 ligne par ligne
  // Booking : à vérifier sur statement réel
  // Direct  : 0,77% sur (cleaning + management) via /1.0077
  const PLATFORM_CLEANING_RATES = { airbnb: 0.1621, booking: 0.1517 }  // Booking ~15,17% mesuré statement Chambre Txomin fév 2026

  let commissionableBase, loyAmount, cleaningFeeNet, platformRateOnCleaning

  if (isDirect) {
    // ── DIRECTE ──────────────────────────────────────────────────────────
    // communityFeeRaw = ménage pour les directes (label "Community fee" Hospitable)
    // managementFeeRaw = frais gestion
    // Hospitable prend 0,77% sur (communityFeeRaw + managementFeeRaw)
    // Base = revenue - TOUS les fees ménage (cleaning + community + management) - taxes
    commissionableBase = revenue - cleaningFeeAirbnb - communityFeeRaw - managementFeeRaw - taxesTotal - adjustmentsTotal + discountsTotal
    const feesDirectBruts = cleaningFeeAirbnb + communityFeeRaw + managementFeeRaw
    // Math.floor pour platformRemb exact (arrondi supérieur sur la retenue)
    const feesDirectNets = feesDirectBruts > 0 ? Math.floor(feesDirectBruts / 1.0077) : 0
    // Ménage net = total net - management = part ménage après déduction commission Hospitable
    cleaningFeeNet = bien.forfait_dcb_ref || Math.max(0, feesDirectNets - managementFeeRaw)
    platformRateOnCleaning = 0
  } else {
    // ── AIRBNB / BOOKING / AUTRES ─────────────────────────────────────────
    // Pour Airbnb : menageBrut = cleaningFeeAirbnb (label "Cleaning fee")
    // communityFeeRaw = commission Airbnb sur hébergement (pas utilisé pour FMEN)
    commissionableBase = accommodation + hostServiceFee + discountsTotal
    // FMEN basé sur le ménage réel (cleaningFeeAirbnb pour Airbnb)
    cleaningFeeNet = bien.forfait_dcb_ref || menageBrut
    platformRateOnCleaning = PLATFORM_CLEANING_RATES[resa.platform] || PLATFORM_CLEANING_RATES.airbnb
  }

  // HON = base × taux (TVA 20%)
  // Direct : Math.floor pour correspondre exactement au statement Hospitable
  const honTTC = isDirect ? Math.floor(commissionableBase * tauxCom) : Math.round(commissionableBase * tauxCom)
  const honHT  = Math.round(honTTC / (1 + TVA_RATE))

  // Part plateforme retenue sur les fees (écriture comptable côté owner dans statement)
  // Airbnb : 16,21% × (cleaning fee + community fee) — vérifié sur statement réel
  // Booking : taux × ménage brut
  // Direct : 0,77% × (cleaning + mgmt) — même logique, remboursé au proprio via LOY
  let platformRembourseMenage
  if (isDirect) {
    // Pour les directes : le remboursement 0,77% s'applique sur TOUS les fees
    // (cleaning + community + management) — vérifié sur statement HOST-3QKPIK
    const feesDirectBruts2 = cleaningFeeAirbnb + communityFeeRaw + managementFeeRaw
    const feesDirectNets2 = feesDirectBruts2 > 0 ? Math.round(feesDirectBruts2 / 1.0077) : 0
    platformRembourseMenage = feesDirectBruts2 - feesDirectNets2
  } else {
    // Airbnb : 13,95% sur (cleaning + community) — même taux que dueToOwner
    // Booking et autres : taux spécifique plateforme sur ménage brut
    const feesBaseForPlatform = (resa.platform === 'airbnb')
      ? (cleaningFeeAirbnb + communityFeeRaw)
      : menageBrut
    const rateForPlatform = (resa.platform === 'airbnb') ? AIRBNB_FEES_RATE : platformRateOnCleaning
    platformRembourseMenage = (resa.platform === 'airbnb')
      ? Math.ceil(rateForPlatform * feesBaseForPlatform)
      : Math.round(rateForPlatform * feesBaseForPlatform)
  }

  // LOY = base - HON + remboursement plateforme (même logique direct et plateforme)
  loyAmount = commissionableBase - honTTC + platformRembourseMenage

  // FMEN = fees_ménage_brut - AUTO (TVA 20%)
  // RÈGLE : platform_remb est une écriture comptable côté owner → LOY uniquement, PAS dans FMEN
  // Airbnb  : fees_ménage = cleaning_fee + community_fee (host service fee)
  // Direct  : fees_ménage = cleaning_fee + community_fee (management_fee = expense séparé → AUTO)
  // Vérifié ligne par ligne sur statement 602 "Horizonte" fév 2026
  const fmenBase = cleaningFeeAirbnb + communityFeeRaw  // = MEN brut (fees ménage voyageur)
  // dueToOwner : part plateforme sur fees ménage (Airbnb 13,95%, Booking 15,17%)
  const dueToOwner = (resa.platform === 'airbnb')
    ? Math.round(fmenBase * AIRBNB_FEES_RATE)
    : (resa.platform === 'booking')
      ? Math.round(fmenBase * PLATFORM_CLEANING_RATES.booking)
      : 0
  const fmenTTC = Math.max(0, fmenBase - dueToOwner - aeAmount)
  const fmenHT  = fmenTTC > 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // ── MEN : ménage brut collecté voyageur (toutes guest fees sauf management) — Hors TVA
  const menLabelsToExclude = ['management fee', 'host service fee']
  const menFees = guestFeesAll.filter(f => !menLabelsToExclude.includes(f.label?.toLowerCase()))
  const menAmount = menFees.reduce((s, f) => s + (f.amount || 0), 0)

  // ── COM : commission DCB sur locations directes (Management fee brut) — TVA 20%
  const comAmount = isDirect ? managementFeeRaw : 0
  const comHT = comAmount > 0 ? Math.round(comAmount / (1 + TVA_RATE)) : 0

  // LOY Booking : recalcul depuis fin_revenue (taux Booking variable sur cleaning)
  if (resa.platform === 'booking') {
    // fin_revenue Hospitable inclut les Remitted taxes → déduire pour avoir le net statement
    const remittedTotal = taxes.filter(t => isRemitted(t)).reduce((s,t) => s + (t.amount||0), 0)
    const finRevenueNet = (resa.fin_revenue || 0) - remittedTotal
    loyAmount = finRevenueNet - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  // --- Lignes de ventilation ---
  const lignes = []

  // MEN — ménage brut collecté voyageur (Hors TVA)
  if (menAmount > 0) {
    lignes.push(ligneHorsTVA('MEN', 'Ménage brut voyageur', menAmount, bien, resa))
  }

  // COM — commission DCB sur locations directes (Management fee, TVA 20%)
  if (comHT > 0) {
    lignes.push(ligneTVA('COM', 'Commission DCB', comHT, bien, resa, null, comAmount))
  }

  // HON — honoraires de gestion (TVA 20%)
  if (honHT > 0) {
    lignes.push(ligneTVA('HON', 'Honoraires de gestion', honHT, bien, resa, tauxCalcule, honTTC))
  }

  // FMEN — forfait ménage DCB = cleaning fee - AUTO (TVA 20%)
  if (fmenHT > 0) {
    lignes.push(ligneTVA('FMEN', 'Forfait ménage', fmenHT, bien, resa, null, fmenTTC))
  }

  // AUTO — débours auto-entrepreneur (hors TVA)
  if (aeAmount > 0) {
    lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', aeAmount, bien, resa))
  }


  // LOY — reversement propriétaire (hors TVA)
  if (loyAmount > 0) {
    lignes.push(ligneHorsTVA('LOY', 'Reversement propriétaire', loyAmount, bien, resa))
  }

  // VIR — virement propriétaire
  // Direct  : LOY + TAXE + 0,77% × (mgmt_fee + cleaning_fee) [Hospitable rembourse sa commission]
  // Airbnb  : LOY + TAXE  [pas de remboursement]
  // Pour les directes : Hospitable prend 0,77% sur (management + community/ménage)
  // VIR direct = LOY + taxes (remboursement 0,77% Hospitable déjà dans platformRemb → LOY)
  const virAmount = loyAmount + taxesTotal
  if (virAmount > 0) {
    lignes.push(ligneHorsTVA('VIR', 'Virement propriétaire', virAmount, bien, resa))
  }

  // TAXE — Airbnb: exclue. Booking: pass-through seulement. Direct: toutes.
  if (resa.platform !== 'airbnb') {
    for (const tax of taxes) {
      if (tax.amount > 0 && !isRemitted(tax)) {
        lignes.push(ligneHorsTVA('TAXE', tax.label || 'Taxe séjour', tax.amount, bien, resa))
      }
    }
  }

  // Supprimer les ventilations existantes pour cette résa
  await supabase.from('ventilation').delete().eq('reservation_id', resa.id)

  // Insérer les nouvelles lignes
  if (lignes.length > 0) {
    const { error } = await supabase.from('ventilation').insert(lignes)
    if (error) throw error
  }

  // Marquer la résa comme ventilée
  await supabase
    .from('reservation')
    .update({ ventilation_calculee: true })
    .eq('id', resa.id)

  // CF-PAE3 : relier mission_menage.ventilation_auto_id à la ligne AUTO
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
  // montantHT  = montant HORS TAXE (ex: 226,04 € = comTTC/1.20)
  // montantTTC = montant TTC (ex: 271,25 € = base × taux)
  // TVA        = montantTTC - montantHT (ex: 45,21 €)
  // Ne JAMAIS passer comTTC comme montantHT — c'est l'erreur historique corrigée
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
 * Récupère la ventilation d'un mois, groupée par propriétaire
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
 * Récapitulatif de ventilation par code pour un mois
 */
export async function getRecapVentilation(mois) {
  const lignes = await getVentilationMois(mois)

  // Récap global par code
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

  // Récap par propriétaire
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
