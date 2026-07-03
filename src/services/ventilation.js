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
import { AGENCE } from '../lib/agence'
import { authPost } from '../lib/authFetch'
import { STATUTS_NON_VENTILABLES } from '../lib/constants'

const TVA_RATE = 0.20
// AIRBNB_LOY_RATE supprimé — remplacé par pro-rata du host_service_fee (voir dueToOwner Airbnb)

/**
 * Calcule et sauvegarde la ventilation pour toutes les réservations
 * d'un mois donné — délégué à /api/ventiler (service_role, pas de blocage RLS).
 *
 * @param {string} mois - YYYY-MM
 */
export async function calculerVentilationMois(mois) {
  const { ok, data } = await authPost('/api/ventiler', { mois, agence: AGENCE })
  if (!ok) throw new Error(data?.error || 'Erreur serveur ventilation')
  return data
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
 * Calcule les lignes de ventilation — fonction PURE, sans appel DB.
 * Utilisée directement dans les tests et appelée par calculerVentilationResa.
 * @param {object} resa — réservation avec bien, reservation_fee chargés
 * @returns {{ lignes: Array }} lignes de ventilation calculées
 */
export function _calculerLignes(resa) {
  const bien = resa.bien
  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)
  if ((bien.agence || AGENCE) !== AGENCE) return { lignes: [] }

  const revenue = resa.fin_revenue || 0

  // --- Extraire les fees ---
  // Priorité : reservation_fee en base (resas importées CSV)
  // Fallback : hospitable_raw.financials.host (resas Booking/Airbnb sans CSV)
  let fees = resa.reservation_fee || []

  if (fees.length === 0 && resa.hospitable_raw?.financials?.host) {
    const fin = resa.hospitable_raw.financials.host
    const rawHostFees = fin.host_fees || []
    const rawGuestFees = fin.guest_fees || []
    const rawTaxes = fin.taxes || []
    // Normalisation labels localisés → anglais canonique
    const LABEL_ALIASES = {
      'frais de ménage': 'cleaning fee',
      'frais de service (5%)': 'community fee',
    }
    const normalizeLabel = l => LABEL_ALIASES[l?.toLowerCase()] ?? l
    fees = [
      ...rawHostFees.map(f => ({ label: normalizeLabel(f.label), amount: f.amount, fee_type: 'host_fee' })),
      ...rawGuestFees.map(f => ({ label: normalizeLabel(f.label), amount: f.amount, fee_type: 'guest_fee' })),
      ...rawTaxes.map(f => ({ label: normalizeLabel(f.label), amount: f.amount, fee_type: 'tax' })),
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
  
  // Ajustements Hospitable (Resolution Center Airbnb) : non qualifiables automatiquement
  // (hébergement ou ménage/extra ?) — voir migration 222. Contribution nulle tant que non
  // qualifié (statut≠'traite'). Détection/insertion faite côté serveur (api/ventiler.js).
  const ajustementsQualifies = (resa.reservation_ajustement || []).filter(a => a.statut === 'traite')
  const ajustementHebergement = ajustementsQualifies.filter(a => a.type === 'hebergement').reduce((s, a) => s + (a.montant || 0), 0)
  // montant_auto n'entre dans aucun calcul (info seulement) — la vraie rémunération AE passe
  // par une prestation_hors_forfait réelle, jamais par cette ligne (sinon double paiement AE).
  const ajustementFmenExtra = ajustementsQualifies.filter(a => a.type === 'menage').reduce((s, a) => s + (a.montant_fmen || 0), 0)

  // Remises promotionnelles (Promotion Discount, Last Minute Discount, Ad-hoc fee...)
  // Tableau séparé dans hospitable_raw.financials.host.discounts (négatifs)
  const discountsRaw = resa.hospitable_raw?.financials?.host?.discounts || []
  const discountsFromApi = discountsRaw.reduce((s, d) => s + (d.amount || 0), 0)
  // Fallback CSV si aucune remise API — fin_discount est positif dans le CSV, on le passe en négatif
  const discountsTotal = discountsFromApi !== 0
    ? discountsFromApi
    : -(resa.fin_discount || 0)

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

  const isDirect = resa.platform === 'direct' || resa.platform === 'manual'
  const isCancelled = STATUTS_NON_VENTILABLES.includes(resa.final_status)

  // Prolongation : critère B (guest_name) ou flag pré-calculé par calculerVentilationMois (critère A)
  const isProlongation = resa.isProlongation === true ||
    (resa.guest_name || '').toLowerCase().includes('prolongation')

  // Réservation annulée mais fin_revenue > 0 (frais d'annulation) → ventiler normalement
  // Cas cancelled + fin_revenue === 0 : géré par calculerVentilationResa (appel DB)

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

  // Supplément voyageurs supplémentaires (EXTRA_GUEST_FEE Airbnb)
  // Hospitable l'inclut dans sa commissionable base — DCB doit faire de même.
  // Validé sur BGH HMS2SR33WH : 20000¢ → commissionableBase +200€ → HON +€44 ✓
  const extraGuestFee = guestFeesAll
    .filter(f => f.label?.toLowerCase() === 'extra_guest_fee')
    .reduce((s, f) => s + (f.amount || 0), 0)

  // AUTO = provision AE (hors TVA)
  // Annulées : pas d'AE.
  // Prolongations explicites : le ménage est sur la résa originale.
  // Direct/manual sans frais ménage (communityFee=0) : pas de ménage à provisionner.
  const aeAmount = (isCancelled || isProlongation || (isDirect && menageBrut === 0)) ? 0 : (bien.provision_ae_ref || 0)

  // Taxes pass-through - Airbnb ET Booking reversent certaines taxes directement (Remitted)
  const isRemitted = t => t.label?.toLowerCase().includes('remitted')
  const taxesTotal = (resa.platform === 'airbnb') ? 0 : taxes.filter(t => !isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)

  // ── Taux commission plateforme sur les fees ───────────────────────────────
  // Toutes plateformes : dueToOwner calculé en pro-rata du host_service_fee (voir dueToOwner)
  // Direct  : dueToOwner = 0

  let commissionableBase, loyAmount, cleaningFeeNet, platformRateOnCleaning

  // Assiette commune de répartition pro-rata : accommodation + Σ guest_fees
  // Utilisée pour Airbnb (dueToOwner) et Direct (ownerFees)
  const totalFeesForOwnerRate = accommodation + guestFeesAll.reduce((s, f) => s + (f.amount || 0), 0)

  // FMEN / ménage — calculé AVANT la base car en fallback le ménage est fondu dans accommodation.
  // Airbnb  : pro-rata du host_service_fee sur la part ménage, net de commission DCB
  //           dueToOwner = round(|hostServiceFee| × fmenBase / (accommodation + Σ guestFees) × (1 − tauxCom))
  //           Vérifié HMRN2R9JTY : round(3751 × 12400 / 24200 × 0.75) = 1442 cts = 14.42 € ✓
  // Booking : même pro-rata. Direct / Manual : dueToOwner = 0.
  // Fallback Airbnb sans frais ménage (cleaning=0 ET community=0 ET forfait_dcb_ref>0) :
  //   Airbnb n'a pas transmis la ligne ménage → fmenBase = forfait_dcb_ref + provision_ae_ref.
  const totalFeesAirbnb = cleaningFeeAirbnb + communityFeeRaw
  const airbnbFallbackActif = resa.platform === 'airbnb' && totalFeesAirbnb === 0 && (bien.forfait_dcb_ref || 0) > 0
  const fmenBase = airbnbFallbackActif
    ? (bien.forfait_dcb_ref || 0) + (bien.provision_ae_ref || 0)
    : totalFeesAirbnb
  const dueToOwner = ((resa.platform === 'airbnb' || resa.platform === 'booking') && totalFeesForOwnerRate > 0)
    ? Math.round(Math.abs(hostServiceFee) * fmenBase / totalFeesForOwnerRate * (1 - tauxCom))
    : 0
  const fmenTTC = Math.max(0, fmenBase - dueToOwner - aeAmount) + ajustementFmenExtra
  // fmenHT peut être négatif si ajustementFmenExtra dépasse la marge FMEN normale (DCB
  // absorbe la perte) — pas de floor à 0 ici, pour que HON+FMEN+AUTO+LOY se recoupe exactement.
  const fmenHT  = fmenTTC !== 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // En fallback, le ménage voyageur NET de la commission Airbnb (= fmenBase − dueToOwner) est
  // fondu dans `accommodation` → on le retranche de la base de commission, sinon HON serait
  // calculé sur le ménage. (Cas normal : le ménage est déjà hors accommodation.)
  const menageFonduAccommodation = airbnbFallbackActif ? (fmenBase - dueToOwner) : 0

  // ── Base de commission — TOUTES PLATEFORMES ──────────────────────────
  //   Airbnb : accommodation + host_service_fee + discounts + extraGuestFee (− ménage fondu si fallback)
  //   Direct : accommodation + host_fees | Booking : accommodation + host_fees
  commissionableBase = accommodation + hostServiceFee + discountsTotal + extraGuestFee - menageFonduAccommodation + ajustementHebergement

  // HON = base × taux (TVA 20%). Direct : Math.floor pour coller au statement Hospitable.
  const honTTC = isDirect ? Math.floor(commissionableBase * tauxCom) : Math.round(commissionableBase * tauxCom)
  const honHT  = Math.round(honTTC / (1 + TVA_RATE))

  // ── MEN : ménage brut collecté voyageur (toutes guest fees sauf management) — Hors TVA
  const menLabelsToExclude = ['management fee', 'host service fee', 'resort fee']
  const menFees = guestFeesAll.filter(f => !menLabelsToExclude.includes(f.label?.toLowerCase()))
  const menAmount = menFees.reduce((s, f) => s + (f.amount || 0), 0)

  // ── COM : commission DCB sur locations directes (Management fee + Resort fee) — TVA 20%
  // Resort fee = provision frais plateforme (1% résa directe) → revient à DCB comme le management fee
  const resortFeeRaw = guestFeesAll.find(f => f.label?.toLowerCase() === 'resort fee')?.amount || 0
  const comAmount = isDirect ? (managementFeeRaw + resortFeeRaw) : 0
  const comHT = comAmount > 0 ? Math.round(comAmount / (1 + TVA_RATE)) : 0

  // Owner fees Direct : portion de la platform fee Hospitable attribuée aux guest fees,
  // reversée à la fraction propriétaire (1 − taux).
  // Formula : round(|hostServiceFee| × fee_i / totalFeesForOwnerRate × (1 − taux))
  // Vérifié sur HOST-9HAQHD : management=24 + community=76 + resort=2 = 102 centimes ✓
  const ownerFees = (isDirect && totalFeesForOwnerRate > 0)
    ? guestFeesAll.reduce((s, f) => s + Math.round(Math.abs(hostServiceFee) * (f.amount || 0) / totalFeesForOwnerRate * (1 - tauxCom)), 0)
    : 0

  // LOY Direct  : commissionableBase - HON + ownerFees (aligné statement Hospitable)
  // LOY Airbnb  : variable de balance (absorbe ajustements, communityFee, hospitable fee)
  // LOY Booking : variable de balance depuis fin_revenue net (remitted taxes déduites)
  if (isDirect) {
    loyAmount = commissionableBase - honTTC + ownerFees
  } else {
    loyAmount = revenue - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  if (resa.platform === 'booking') {
    const remittedTotal = taxes.filter(t => isRemitted(t)).reduce((s,t) => s + (t.amount||0), 0)
    // CITY_TAX (Withheld Tax) est déjà exclu de host.revenue.amount — ne pas déduire une 2e fois
    loyAmount = (revenue - remittedTotal) - honTTC - fmenTTC - aeAmount - taxesTotal
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

  // FMEN — forfait ménage DCB = cleaning fee - AUTO (TVA 20%). Peut être négatif (voir formule
  // fmenHT plus haut) si un ajustement dépasse la marge normale — ligne créée quand même.
  if (fmenHT !== 0) {
    lignes.push(ligneTVA('FMEN', 'Forfait ménage', fmenHT, bien, resa, null, fmenTTC))
  }

  // AUTO — débours auto-entrepreneur (hors TVA)
  if (aeAmount > 0) {
    lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', aeAmount, bien, resa))
  }


  // LOY + VIR — exclus si gestion_loyer=false sur plateforme externe (Airbnb/Booking)
  // Dans ce cas, le loyer est versé directement au proprio par la plateforme.
  // DCB ne détient pas les fonds → pas de reversement ni de virement à faire.
  // Pour les resas directes/manuelles, même bien hors-séquestre : DCB perçoit le loyer → LOY+VIR normaux.
  const horsSequestre = bien.gestion_loyer === false && (resa.platform === 'airbnb' || resa.platform === 'booking')

  // LOY — reversement propriétaire (hors TVA)
  if (loyAmount > 0 && !horsSequestre) {
    lignes.push(ligneHorsTVA('LOY', 'Reversement propriétaire', loyAmount, bien, resa))
  }

  // VIR — virement propriétaire = LOY + taxes pass-through
  const virAmount = loyAmount + taxesTotal
  if (virAmount > 0 && !horsSequestre) {
    lignes.push(ligneHorsTVA('VIR', 'Virement propriétaire', virAmount, bien, resa))
  }

  // TAXE — Airbnb: exclue. Booking: pass-through seulement. Direct: toutes.
  // Booking importe la TVA côté guest ET côté host → reservation_fee peut contenir
  // deux lignes identiques (même label, même montant). On déduplique par (label+montant)
  // pour éviter la violation de ventilation_resa_code_libelle_unique.
  if (resa.platform !== 'airbnb') {
    const seen = new Set()
    for (const tax of taxes) {
      if (tax.amount > 0 && !isRemitted(tax)) {
        const label = tax.label || 'Taxe séjour'
        const key = `${label}|${tax.amount}`
        if (!seen.has(key)) {
          seen.add(key)
          lignes.push(ligneHorsTVA('TAXE', label, tax.amount, bien, resa))
        }
      }
    }
  }

  return {
    lignes,
    isProlongation,
    fallbackAirbnb: airbnbFallbackActif ? {
      motif: 'airbnb_fees_missing',
      forfait_dcb_ref: bien.forfait_dcb_ref,
      provision_ae_ref: bien.provision_ae_ref || 0,
      fmenBase,
    } : null,
  }
}

/**
 * Recalcule la ventilation d'une réservation individuelle —
 * délégué à /api/ventiler (service_role, pas de blocage RLS).
 */
export async function calculerVentilationResa(resa) {
  const { ok, data } = await authPost('/api/ventiler', { reservation_id: resa.id, agence: AGENCE })
  if (!ok) throw new Error(data?.error || 'Erreur serveur ventilation')
}

/**
 * Qualifie un ajustement Hospitable (voir migration 222) comme 'hebergement' ou 'menage'
 * et reventile la résa concernée — délégué à /api/qualifier-ajustement.
 */
export async function qualifierAjustement(ajustementId, type, { montantFmen, montantAuto } = {}) {
  const body = { ajustement_id: ajustementId, type }
  if (type === 'menage') { body.montant_fmen = montantFmen; body.montant_auto = montantAuto }
  const { ok, data } = await authPost('/api/qualifier-ajustement', body)
  if (!ok) throw new Error(data?.error || 'Erreur qualification ajustement')
  return data
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
      bien (hospitable_name, code, agence),
      proprietaire (id, nom, prenom)
    `)
    .eq('mois_comptable', mois)
    .order('code')

  if (error) throw error
  return (data || []).filter(l => !l.bien?.agence || l.bien.agence === AGENCE)
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

/**
 * Ajustement manuel « total constant » de la ventilation (fonctionnalité rare —
 * modal Réservations). `edits` = { CODE: nouveau_TTC_centimes } pour les lignes
 * prestations (HON, FMEN, AUTO). Le HT est recalculé (TTC / 1,20 pour les lignes
 * TVA, = TTC pour AUTO hors TVA) et LOY + VIR absorbent le delta → le total de la
 * résa est conservé PAR CONSTRUCTION. Pose reservation.ventilation_manuelle = true :
 * plus aucun recalcul auto (api/ventiler + ventilation-auto nightly, migration 226).
 */
export async function ajusterVentilationManuelle(resa, edits) {
  const lignes = resa.ventilation || []
  const get = (c) => lignes.find(l => l.code === c)
  let delta = 0
  const updates = []
  for (const [code, ttcNew] of Object.entries(edits)) {
    const l = get(code)
    if (!l || ttcNew == null || ttcNew < 0) continue
    const horsTVA = code === 'AUTO'
    const ttcOld = l.montant_ttc ?? l.montant_ht ?? 0
    if (ttcNew === ttcOld) continue
    const ht = horsTVA ? ttcNew : Math.round(ttcNew / 1.2)
    updates.push({ id: l.id, vals: { montant_ht: ht, montant_tva: horsTVA ? l.montant_tva : ttcNew - ht, montant_ttc: ttcNew, calcul_source: 'manual' } })
    delta += ttcOld - ttcNew
  }
  if (!updates.length) return { changed: false, delta: 0 }

  const loy = get('LOY')
  if (!loy) throw new Error('Ligne LOY absente — ajustement impossible sur cette résa')
  const loyNew = (loy.montant_ht || 0) + delta
  if (loyNew < 0) throw new Error('Le reversement propriétaire deviendrait négatif (' + (loyNew / 100).toFixed(2) + ' €)')
  updates.push({ id: loy.id, vals: { montant_ht: loyNew, montant_ttc: loyNew, calcul_source: 'manual' } })
  const vir = get('VIR')
  if (vir) updates.push({ id: vir.id, vals: { montant_ht: (vir.montant_ht || 0) + delta, montant_ttc: (vir.montant_ttc ?? vir.montant_ht ?? 0) + delta, calcul_source: 'manual' } })

  for (const u of updates) {
    if (!u.id) throw new Error('Ligne de ventilation sans id — rechargez la page')
    const { error } = await supabase.from('ventilation').update(u.vals).eq('id', u.id)
    if (error) throw error
  }
  const { error: flagErr } = await supabase.from('reservation').update({ ventilation_manuelle: true }).eq('id', resa.id)
  if (flagErr) throw flagErr

  logOp({
    categorie: 'ventilation', action: 'ajustement_manuel', statut: 'ok', source: 'app',
    mois_comptable: resa.mois_comptable, reservation_id: resa.id, bien_id: resa.bien?.id || resa.bien_id,
    message: `Ajustement manuel ${resa.code} : ` + Object.entries(edits).map(([c, v]) => `${c}=${(v / 100).toFixed(2)}€ TTC`).join(', ') + ` → delta LOY ${(delta / 100).toFixed(2)}€ (total conservé)`,
    meta: { edits, delta },
  })
  return { changed: true, delta }
}

/** Lève le verrou d'ajustement manuel — la résa redevient recalculable par les moteurs auto. */
export async function reactiverVentilationAuto(resaId) {
  const { error } = await supabase.from('reservation').update({ ventilation_manuelle: false }).eq('id', resaId)
  if (error) throw error
}
