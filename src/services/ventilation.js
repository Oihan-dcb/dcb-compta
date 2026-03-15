/**
 * Service de calcul de ventilation comptable
 * Transforme les financials Hospitable en lignes comptables DCB
 *
 * Codes ventilation :
 * COM  — Commission DCB (% accommodation) — TVA 20%
 * MEN  — Forfait ménage DCB (guest_fees - provision AE) — TVA 20%
 * MGT  — Management fee résa directe — TVA 20%
 * AE   — Débours auto-entrepreneur — Hors TVA
 * HON  — Honoraires de gestion DCB — TVA 20%
 * FMEN — Forfait ménage (total ménage - MOE provisionnée) — TVA 20%
 * AUTO — Débours auto-entrepreneur — Hors TVA
 * LOY  — Reversement propriétaire — Hors TVA
 * TAXE — Taxe de séjour — Hors TVA
 * DIV  — Frais divers DCB (expenses [DCB]) — TVA 20%
 * TAX  — Taxe de séjour (pass-through) — Hors TVA, tracé uniquement
 */

import { supabase } from '../lib/supabase'

const TVA_RATE = 0.20

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
        proprietaire (id, taux_commission)
      ),
      reservation_fee (*)
    `)
    .eq('mois_comptable', mois)
    .eq('ventilation_calculee', false)
    .eq('owner_stay', false)       // Ignorer séjours proprio
    // NE PAS exclure les annulées ici — certaines ont des valeurs (Airbnb/Booking)
    // Le filtre revenue=0 dans calculerVentilationResa gère les vraies annulées à zéro
    // Les directes annulées sont gérées par early return dans calculerVentilationResa

  if (error) throw error

  let total = 0
  let errors = 0

  for (const resa of (reservations || [])) {
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
 * Agrège les séjours proprio (owner_stay=true) pour affichage séparé
 */
export function agregerSejoursProrio(reservations) {
  const sejours = {}
  for (const resa of reservations) {
    if (!resa.owner_stay) continue
    const ventil = resa.ventilation || []
    if (ventil.length === 0) continue
    const propId = resa.bien?.proprietaire_id || 'sans_proprio'
    const propNom = resa.bien?.proprietaire
      ? `${resa.bien.proprietaire.nom}${resa.bien.proprietaire.prenom ? ' ' + resa.bien.proprietaire.prenom : ''}`
      : 'Sans propriétaire'
    if (!sejours[propId]) {
      sejours[propId] = { id: propId, nom: propNom, total_fmen: 0, nb_resas: 0 }
    }
    const p = sejours[propId]
    p.nb_resas++
    for (const l of ventil) {
      if (l.code === 'FMEN') p.total_fmen += l.montant_ttc
    }
  }
  return Object.values(sejours).filter(p => p.total_fmen > 0)
}

/**
 * Calcule la ventilation d'une réservation individuelle
 */
export async function calculerVentilationResa(resa) {
  const bien = resa.bien

  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)

  // Revenue = montant net reçu en banque (en centimes)
  const revenue = resa.fin_revenue || 0
  if (revenue === 0) return // Réservation à €0, rien à ventiler

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
  const managementFeeRaw = (guestFeesAll.find(f => f.label?.toLowerCase().includes('management'))?.amount || 0)
  // Ménage = "community fee" (Airbnb) ou "frais de ménage" / "cleaning fee" (Booking/autres)
  const communityFeeRaw = (guestFeesAll.find(f =>
    f.label?.toLowerCase().includes('community') ||
    f.label?.toLowerCase().includes('ménage') ||
    f.label?.toLowerCase().includes('menage') ||
    f.label?.toLowerCase().includes('cleaning')
  )?.amount || 0)

  // AUTO = provision AE (hors TVA)
  // Pour les réservations annulées non-directes (Airbnb/Booking avec frais) : pas de provision AE
  const aeAmount = isCancelled ? 0 : (bien.provision_ae_ref || 0)

  // Taxes pass-through
  const taxesTotal = taxes.reduce((s, t) => s + (t.amount || 0), 0)

  // ── Taux commission plateforme sur le ménage ──────────────────────────────
  // Airbnb  : 13,95% sur le community fee
  // Booking : 13,83% sur le frais de ménage
  // Direct  : 0,77% (corrigé via /1,0077 sur FMEN)
  const PLATFORM_CLEANING_RATES = { airbnb: 0.1395, booking: 0.1383 }

  let commissionableBase, loyAmount, cleaningFeeNet, platformRateOnCleaning

  if (isDirect) {
    // ── DIRECTE ──────────────────────────────────────────────────────────
    // Base = revenue - mgmt_fee - cleaning_fee - taxes
    commissionableBase = revenue - managementFeeRaw - communityFeeRaw - taxesTotal - adjustmentsTotal
    // Cleaning net = community fee / 1,0077 (corrige la commission Hospitable)
    cleaningFeeNet = bien.forfait_dcb_ref || (communityFeeRaw > 0 ? Math.round(communityFeeRaw / 1.0077) : 0)
    platformRateOnCleaning = 0
  } else {
    // ── AIRBNB / BOOKING / AUTRES ─────────────────────────────────────────
    // Base = net income - ménage = (accommodation + host_fees) - community_fee
    // hostServiceFee inclut TOUS les host_fees (HSF + Payment Charge pour Booking)
    commissionableBase = accommodation + hostServiceFee
    // Taux spécifique à la plateforme sur le ménage
    cleaningFeeNet = bien.forfait_dcb_ref || communityFeeRaw
    platformRateOnCleaning = PLATFORM_CLEANING_RATES[resa.platform] || PLATFORM_CLEANING_RATES.airbnb
  }

  // HON = base × taux (TVA 20%)
  const honTTC = Math.round(commissionableBase * tauxCom)
  const honHT  = Math.round(honTTC / (1 + TVA_RATE))

  // Part plateforme remboursée sur le ménage (ex: 13,95% × 97€ = 13,53€)
  const platformRembourseMenage = Math.round(platformRateOnCleaning * communityFeeRaw)

  // LOY = base - HON + remboursement plateforme sur ménage
  loyAmount = commissionableBase - honTTC + platformRembourseMenage

  // FMEN = cleaning fee net - part plateforme - AUTO (TVA 20%)
  const fmenTTC = Math.max(0, cleaningFeeNet - platformRembourseMenage - aeAmount)
  const fmenHT  = fmenTTC > 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // --- Lignes de ventilation ---
  const lignes = []

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
  const feesHospBruts = managementFeeRaw + communityFeeRaw
  const remboursHosp = isDirect ? Math.round(feesHospBruts * 0.0077) : 0
  const virAmount = loyAmount + taxesTotal + remboursHosp
  if (virAmount > 0) {
    lignes.push(ligneHorsTVA('VIR', 'Virement propriétaire', virAmount, bien, resa))
  }

  // TAX — taxes pass-through (tracé, hors TVA)
  for (const tax of taxes) {
    if (tax.amount > 0) {
      lignes.push(ligneHorsTVA('TAXE', tax.label || 'Taxe séjour', tax.amount, bien, resa))
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
    if (l.code === 'HON') p.total_com += l.montant_ht
    if (l.code === 'FMEN') p.total_men += l.montant_ht
    if (l.code === 'LOY') p.total_loy += l.montant_ht
    if (l.code === 'AUTO') p.total_auto += l.montant_ht
    if (l.code === 'VIR') p.total_vir += l.montant_ttc
  }

  return {
    parCode: Object.values(recap),
    parProprio: Object.values(parProprio).sort((a, b) => a.nom.localeCompare(b.nom)),
    lignes,
  }
}
