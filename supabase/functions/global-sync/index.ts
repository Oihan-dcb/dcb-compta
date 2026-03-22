import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const HOSP_TOKEN   = Deno.env.get('HOSPITABLE_TOKEN') ?? ''
const BASE_URL     = 'https://public.api.hospitable.com/v2'

// Client Supabase module-level (partagé entre toutes les fonctions)
let supabase = null

// ── Hospitable API ──────────────────────────────────────────────────────────
async function apiFetch(path, params = {}) {
  if (!HOSP_TOKEN) throw new Error('Token Hospitable non configuré')

  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([key, val]) => {
    if (Array.isArray(val)) {
      val.forEach(v => url.searchParams.append(`${key}[]`, v))
    } else if (val !== undefined && val !== null) {
      url.searchParams.set(key, val)
    }
  })

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${HOSP_TOKEN}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Hospitable API ${res.status}: ${err.message || url.pathname}`)
  }

  return res.json()
}


async function fetchAll(path, params = {}, pageSize = 50) {
  let page = 1, all = []
  while (true) {
    const data = await apiFetch(path, { ...params, limit: pageSize, page })
    const items = data.data || []
    all = all.concat(items)
    const meta = data.meta || {}
    if (page >= (meta.last_page || 1) || all.length >= (meta.total || items.length)) break
    page++
  }
  return all
}

async function fetchProperties() { return fetchAll('/properties') }

async function fetchReservations(propertyIds, opts = {}) {
  if (!propertyIds?.length) return []
  const params = { properties: propertyIds, include: 'financials,guests' }
  if (opts.startDate) params.start_date = opts.startDate
  if (opts.endDate)   params.end_date   = opts.endDate
  return fetchAll('/reservations', params)
}

async function fetchPayoutsForMonth(mois) {
  const [year, month] = mois.split('-').map(Number)
  const startTs = new Date(year, month - 1, 1).getTime()
  const endTs   = new Date(year, month, 0, 23, 59, 59).getTime()
  const result  = []
  let page = 1
  while (true) {
    const data = await apiFetch('/payouts', { include: 'transactions', limit: 50, page })
    const items = data.data || []
    for (const p of items) {
      const ts = new Date(p.paid_at || p.payout_date || p.created_at).getTime()
      if (ts < startTs) return result
      if (ts <= endTs) result.push(p)
    }
    if (page >= (data.meta?.last_page || 1)) break
    page++
  }
  return result
}

// ── Parse réservation ─────────────────────────────────────────────────────────
function parseReservation(resa, bien, mois) {
  const fin = resa.financials?.host || {}
  const guest = resa.guests?.[0] || {}

  // Extraire le host service fee (commission plateforme)
  const hostServiceFee = (fin.host_fees || []).find(f =>
    f.label?.toLowerCase().includes('host service') ||
    f.label?.toLowerCase().includes('service fee')
  )

  // Total taxes pass-through
  const taxesTotal = (fin.taxes || []).reduce((s, t) => s + (t.amount || 0), 0)

  // Mois comptable = mois du check-in (config DCB)
  const arrivalDate = resa.arrival_date ? new Date(resa.arrival_date) : null
  const moisComptable = arrivalDate ? resa.arrival_date?.substring(0,7) : mois

  return {
    hospitable_id: resa.id,
    bien_id: bien.id,
    code: resa.code,
    platform: (resa.platform === 'booking.com' ? 'booking' : resa.platform),
    platform_id: resa.platform_id,
    arrival_date: resa.arrival_date?.substring(0, 10),
    departure_date: resa.departure_date?.substring(0, 10),
    nights: resa.nights,
    checkin_time: resa.check_in,
    checkout_time: resa.check_out,
    guest_name: guest.name || resa.guests?.map?.(g => g.name).join(', '),
    guest_count: resa.guests?.reduce?.((s, g) => s + (g.count || 1), 0) || null,
    stay_type: resa.stay_type || 'guest',
    owner_stay: resa.owner_stay || false,
    reservation_status: resa.reservation_status,
    final_status: resa.reservation_status?.current?.category || resa.status || 'accepted',
    // Financials en centimes
    fin_accommodation: fin.accommodation?.amount ?? null,
    fin_revenue: fin.revenue?.amount ?? null,
    fin_host_service_fee: hostServiceFee?.amount ?? null,
    fin_taxes_total: taxesTotal || null,
    fin_currency: fin.currency || 'EUR',
    mois_comptable: moisComptable,
    hospitable_raw: resa,
  }
}

/**
 * Sync les fees détaillés d'une réservation
 * Supprime et recrée pour garantir la cohérence
 */

async function syncReservationFees(reservationId, hostFinancials) {
  // Supprimer les fees existants
  await supabase.from('reservation_fee').delete().eq('reservation_id', reservationId)

  const fees = []

  // Guest fees (Cleaning Fee, Community Fee, Management Fee)
  for (const fee of (hostFinancials.guest_fees || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'guest_fee',
      label: fee.label,
      category: fee.category,
      amount: fee.amount,
      formatted: fee.formatted,
    })
  }

  // Host fees (Host Service Fee = commission plateforme)
  for (const fee of (hostFinancials.host_fees || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'host_fee',
      label: fee.label,
      category: fee.category,
      amount: fee.amount,
      formatted: fee.formatted,
    })
  }

  // Taxes (taxe de séjour, additionnelles...)
  for (const tax of (hostFinancials.taxes || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'tax',
      label: tax.label,
      category: tax.category,
      amount: tax.amount,
      formatted: tax.formatted,
    })
  }

  // Accommodation breakdown (prix par nuit)
  for (const night of (hostFinancials.accommodation_breakdown || [])) {
    fees.push({
      reservation_id: reservationId,
      fee_type: 'accommodation_night',
      label: night.label,
      category: night.category,
      amount: night.amount,
      formatted: night.formatted,
      nuit_date: night.label, // label = date YYYY-MM-DD
    })
  }

  if (fees.length > 0) {
    const { error } = await supabase.from('reservation_fee').insert(fees)
    if (error) console.error('Erreur insert fees:', error)
  }
}

// ── Ventilation ──────────────────────────────────────────────────────────────

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
async function calculerVentilationResa(resa) {
  const bien = resa.bien

  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)

  if (bien.gestion_loyer === false) return []  // Proprio gere le loyer
  if ((bien.agence || 'dcb') !== 'dcb') return []  // Bien Lauian - comptabilite separee - pas de ventilation

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
}

async function calculerVentilationMois(mois) {
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
    .eq('owner_stay', false)       // Ignorer séjours proprio
    // NE PAS exclure les annulées ici — certaines ont des valeurs (Airbnb/Booking)
    // Le filtre revenue=0 dans calculerVentilationResa gère les vraies annulées à zéro
    // Les directes annulées sont gérées par early return dans calculerVentilationResa

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
 * Agrège les séjours proprio (owner_stay=true) pour affichage séparé
 */

// ── Payouts + Matching ───────────────────────────────────────────────────────
async function syncPayouts(mois) {
  const log = { created: 0, updated: 0, errors: 0, total: 0 }

  try {
    // Récupérer les payouts du mois depuis Hospitable
    const [year, month] = mois.split('-').map(Number)
    const startDate = `${mois}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${mois}-${String(lastDay).padStart(2, '0')}`

    // Utiliser fetchPayoutsForMonth (early exit, évite pagination infinie)
    const payouts = await fetchPayoutsForMonth(mois)
    log.total = payouts.length

    if (payouts.length === 0) {
      // L'API Hospitable ne supporte pas le filtre date sur /payouts
      // → paginer manuellement et s'arrêter dès qu'on dépasse le mois cible
      const filtered = await fetchPayoutsForMonth(mois)
      return syncPayoutsData(filtered, mois, log)
    }

    return syncPayoutsData(payouts, mois, log)
  } catch (err) {
    console.error('Erreur sync payouts:', err)
    try { await supabase.from('import_log').insert({
      type: 'hospitable_payouts', mois_concerne: mois,
      statut: 'error', nb_erreurs: 1, message: err.message,
    }) } catch (_) {}
    throw err
  }
}

async function syncPayoutsData(payouts, mois, log) {
  // Récupérer les payouts existants
  const { data: existing } = await supabase
    .from('payout_hospitable')
    .select('id, hospitable_id')
    .eq('mois_comptable', mois)

  const existingMap = new Map((existing || []).map(p => [p.hospitable_id, p]))

  const toUpsert = payouts.map(p => ({
    hospitable_id: p.id,
    platform: p.platform,
    platform_id: p.platform_id || null,
    reference: p.reference || null,
    amount: p.amount?.amount ?? 0,
    date_payout: (p.date || p.date_payout || '').substring(0, 10),
    bank_account: p.bank_account || null,
    mois_comptable: mois,
    statut_matching: 'en_attente',
  }))

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from('payout_hospitable')
      .upsert(toUpsert, { onConflict: 'hospitable_id', ignoreDuplicates: false })

    if (error) throw error

    // Peupler payout_reservation depuis les transactions Hospitable
    // Les transactions contiennent les réservations incluses dans chaque payout
    const { data: savedPayouts } = await supabase
      .from('payout_hospitable')
      .select('id, hospitable_id')
      .in('hospitable_id', payouts.map(p => p.id))

    const payoutIdMap = new Map((savedPayouts || []).map(p => [p.hospitable_id, p.id]))

    const prLinks = []
    for (const payout of payouts) {
      const dbId = payoutIdMap.get(payout.id)
      if (!dbId) continue
      const txns = payout.transactions?.data || payout.transactions || []
      for (const tx of txns) {
        // Trouver la réservation Hospitable correspondante
        const resaCode = tx.reservation?.confirmation_code || tx.confirmation_code || tx.reservation_id
        if (!resaCode) continue
        const { data: resa } = await supabase
          .from('reservation')
          .select('id')
          .eq('code', resaCode)
          .single()
        if (resa?.id) {
          prLinks.push({ payout_id: dbId, reservation_id: resa.id })
        }
      }
    }

    if (prLinks.length > 0) {
      await supabase
        .from('payout_reservation')
        .upsert(prLinks, { onConflict: 'payout_id,reservation_id', ignoreDuplicates: true })
    }
  }

  log.created = toUpsert.filter(p => !existingMap.has(p.hospitable_id)).length
  log.updated = toUpsert.filter(p => existingMap.has(p.hospitable_id)).length

  await supabase.from('import_log').insert({
    type: 'hospitable_payouts', mois_concerne: mois,
    statut: 'success',
    nb_lignes_traitees: log.total,
    nb_lignes_creees: log.created,
    nb_lignes_mises_a_jour: log.updated,
    message: `Sync payouts ${mois} — ${log.created} créés, ${log.updated} mis à jour`,
  })

  return log
}

// ============================================================
// MOTEUR DE MATCHING BANCAIRE
// ============================================================

/**
 * Lance le matching automatique pour tous les mouvements entrants
 * non rapprochés d'un mois donné
 *
 * @param {string} mois - YYYY-MM
 * @returns {Promise<{matched, unmatched, errors}>}
 */
async function lancerMatching(mois) {
  const result = { matched: 0, unmatched: 0, errors: 0 }

  // Récupérer les mouvements entrants en attente
  const { data: mouvements, error: mvtErr } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
    .eq('statut_matching', 'en_attente')
    .not('credit', 'is', null)
    .gt('credit', 5) // Ignorer les virements test < 0.05€

  if (mvtErr) throw mvtErr

  // Récupérer les payouts Hospitable du mois non matchés
  const { data: payouts, error: pErr } = await supabase
    .from('payout_hospitable')
    .select('*')
    .eq('mois_comptable', mois)
    .eq('statut_matching', 'en_attente')

  if (pErr) throw pErr

  // Récupérer les réservations du mois non rapprochées + airbnb_account du bien
  const { data: reservations, error: rErr } = await supabase
    .from('reservation')
    .select('id, code, platform, fin_revenue, arrival_date, guest_name, bien(code, airbnb_account)')
    .eq('mois_comptable', mois)
    .eq('rapprochee', false)
    .eq('owner_stay', false)

  if (rErr) throw rErr

  // Enrichir les resas avec airbnb_account pour faciliter le matching
  const resasEnrichies = (reservations || []).map(r => ({
    ...r,
    airbnb_account: r.bien?.airbnb_account || null,
    bien_code: r.bien?.code || null,
  }))

  // Matcher chaque mouvement
  for (const mvt of (mouvements || [])) {
    try {
      const matchResult = await matcherMouvement(mvt, payouts || [], resasEnrichies)
      if (matchResult.matched) {
        result.matched++
      } else {
        result.unmatched++
      }
    } catch (err) {
      console.error(`Erreur matching mouvement ${mvt.id}:`, err)
      result.errors++
    }
  }

  return result
}

/**
 * Tente de matcher un mouvement bancaire avec un ou plusieurs payouts/réservations
 */
async function matcherMouvement(mvt, payouts, reservations) {
  const canal = mvt.canal

  // --- Booking : match par référence ---
  if (canal === 'booking') {
    return matcherBooking(mvt, payouts, reservations)
  }

  // --- Stripe : match par mois + montant ---
  if (canal === 'stripe') {
    return matcherStripe(mvt, payouts, reservations)
  }

  // --- Airbnb : match direct sur resas si pas de payouts dispo ---
  if (canal === 'airbnb') {
    return matcherAirbnb(mvt, payouts, reservations)
  }

  // --- SEPA manuel : match par montant exact + nom ---
  if (canal === 'sepa_manuel') {
    return matcherSepa(mvt, reservations)
  }

  return { matched: false, raison: 'Canal non géré : ' + canal }
}

// ============================================================
// MATCHERS PAR CANAL
// ============================================================

/**
 * Booking : extrait la référence du libellé CE et cherche le payout correspondant
 * Libellé CE : "NO.P2CHcbU2X61HOcYD/ID.10415482"
 */
async function matcherBooking(mvt, payouts) {
  // Extraire la référence depuis le détail bancaire
  // Format : NO.{reference}/ID.{property_id}
  const detail = mvt.detail || mvt.libelle || ''
  const refMatch = detail.match(/NO\.([A-Za-z0-9]+)/)
  if (!refMatch) return { matched: false, raison: 'Référence Booking introuvable dans libellé' }

  const ref = refMatch[1]

  // Chercher dans les payouts Hospitable
  const payout = payouts.find(p =>
    p.platform === 'booking' &&
    p.reference === ref &&
    p.statut_matching === 'en_attente'
  )

  if (!payout) {
    // Chercher aussi dans Supabase si pas encore en mémoire
    const { data: found } = await supabase
      .from('payout_hospitable')
      .select('*')
      .eq('reference', ref)
      .eq('platform', 'booking')
      .single()

    if (!found) return { matched: false, raison: `Payout Booking ref=${ref} non trouvé` }

    return confirmerMatch(mvt, [found], 'matche_auto', `Booking ref ${ref}`)
  }

  return confirmerMatch(mvt, [payout], 'matche_auto', `Booking ref ${ref}`)
}

/**
 * Stripe : 1 virement mensuel → match sur mois + montant total
 */
async function matcherStripe(mvt, payouts) {
  const mois = mvt.mois_releve

  // Chercher payouts Stripe du mois avec montant proche
  const stripePayout = payouts.find(p =>
    p.platform === 'direct' || p.platform === 'stripe' ||
    (p.platform_id && p.bank_account?.toLowerCase().includes('stripe'))
  )

  if (!stripePayout) {
    // Chercher dans Supabase par mois et montant approché
    const { data: found } = await supabase
      .from('payout_hospitable')
      .select('*')
      .eq('mois_comptable', mois)
      .gte('amount', mvt.credit - 200)    // ±2€ de tolérance
      .lte('amount', mvt.credit + 200)
      .eq('statut_matching', 'en_attente')
      .limit(1)
      .single()

    if (!found) return { matched: false, raison: 'Payout Stripe non trouvé pour ce mois' }
    return confirmerMatch(mvt, [found], 'matche_auto', `Stripe ${mois}`)
  }

  // Vérifier que le montant correspond (tolérance ±5€ car frais Stripe variables)
  if (Math.abs(stripePayout.amount - mvt.credit) <= 500) {
    return confirmerMatch(mvt, [stripePayout], 'matche_auto', 'Stripe mensuel')
  }

  return { matched: false, raison: `Stripe : montant CE ${mvt.credit} ≠ payout ${stripePayout.amount}` }
}

/**
 * Airbnb : match par montant ±2 centimes + date ±3 jours
 * Si pas de match simple → tente subset sum sur les payouts non matchés
 */
async function matcherAirbnb(mvt, payouts, reservations = []) {
  const montant = mvt.credit
  const dateMvt = new Date(mvt.date_operation)

  // --- Priorité 1 : match via payouts Hospitable si disponibles ---
  const airbnbPayouts = payouts.filter(p => p.platform === 'airbnb' && p.statut_matching === 'en_attente')

  if (airbnbPayouts.length > 0) {
    const matchDirect = airbnbPayouts.find(p => {
      const ecartMontant = Math.abs(p.amount - montant) <= 2
      const datePayout = new Date(p.date_payout)
      const ecartJours = Math.abs((datePayout - dateMvt) / (1000 * 60 * 60 * 24))
      return ecartMontant && ecartJours <= 3
    })
    if (matchDirect) {
      return confirmerMatch(mvt, [matchDirect], 'matche_auto', `Airbnb direct ${matchDirect.amount}c`)
    }
    const subsetResult = subsetSum(airbnbPayouts, montant, dateMvt)
    if (subsetResult.found && subsetResult.combinations.length === 1) {
      return confirmerMatch(mvt, subsetResult.combinations[0], 'matche_auto',
        `Airbnb groupé (${subsetResult.combinations[0].length} résa)`)
    }
  }

  // --- Priorité 2 : match direct sur réservations groupées par compte Airbnb ---
  // Toutes les resas Airbnb non rapprochées
  const airbnbResas = reservations.filter(r => r.platform === 'airbnb' && !r.rapprochee && r.fin_revenue > 0)

  // Grouper par airbnb_account (dynamique — basé sur les données en base)
  // Si un bien n'a pas de compte renseigné → groupe "null" (traité individuellement)
  const groupes = {}
  for (const r of airbnbResas) {
    const compte = r.airbnb_account || '__inconnu__'
    if (!groupes[compte]) groupes[compte] = []
    groupes[compte].push(r)
  }

  // Tentative 1 : match exact dans chaque groupe (1 resa = 1 virement)
  for (const [compte, resas] of Object.entries(groupes)) {
    const resaDirecte = resas.find(r => Math.abs((r.fin_revenue || 0) - montant) <= 2)
    if (resaDirecte) {
      return confirmerMatchResa(mvt, [resaDirecte], 'matche_auto',
        `Airbnb resa directe ${resaDirecte.code}${compte !== '__inconnu__' ? ' ['+compte+']' : ''}`)
    }
  }

  // Tentative 2 : subset sum dans chaque groupe (virement groupé = N resas du même compte)
  for (const [compte, resas] of Object.entries(groupes)) {
    if (resas.length < 2) continue // pas assez de resas pour un groupé
    const subsetResas = subsetSumResas(resas, montant)
    if (subsetResas.found && subsetResas.resas.length > 0) {
      return confirmerMatchResa(mvt, subsetResas.resas, 'matche_auto',
        `Airbnb groupé ${subsetResas.resas.length} resas${compte !== '__inconnu__' ? ' ['+compte+']' : ''}`)
    }
  }

  // Tentative 3 : fallback tous comptes confondus (si aucun compte renseigné)
  const allHaveAccount = airbnbResas.every(r => r.airbnb_account)
  if (!allHaveAccount) {
    const subsetAll = subsetSumResas(airbnbResas, montant)
    if (subsetAll.found && subsetAll.resas.length > 0) {
      return confirmerMatchResa(mvt, subsetAll.resas, 'matche_auto',
        `Airbnb groupé ${subsetAll.resas.length} resas (comptes non configurés)`)
    }
  }

  return { matched: false, raison: `Airbnb : aucun match pour ${montant}c — vérifier les comptes Airbnb dans Biens` }
}

/**
 * SEPA manuel : match sur montant exact + recherche nom dans détail
 */
async function matcherSepa(mvt, reservations) {
  const montant = mvt.credit
  const detail = (mvt.detail || '').toLowerCase()

  // Chercher une réservation avec revenue = montant ±5c (variations possibles)
  const match = reservations.find(r => {
    const ecartMontant = Math.abs((r.fin_revenue || 0) - montant) <= 5
    if (!ecartMontant) return false

    // Si on a un nom dans le détail, vérifier qu'il correspond
    if (detail && r.guest_name) {
      const nomNorm = r.guest_name.toLowerCase().split(' ')
      const nomDansDetail = nomNorm.some(n => n.length > 2 && detail.includes(n))
      return nomDansDetail
    }

    return ecartMontant
  })

  if (match) {
    // Créer un payout virtuel pour les réservations manuelles
    const { data: payout } = await supabase
      .from('payout_hospitable')
      .insert({
        hospitable_id: `manual_${mvt.id}`,
        platform: 'manual',
        amount: montant,
        date_payout: mvt.date_operation,
        mois_comptable: mvt.mois_releve,
        statut_matching: 'en_attente',
      })
      .select()
      .single()

    if (payout) {
      // Lier à la réservation
      try { await supabase.from('payout_reservation').insert({
        payout_id: payout.id,
        reservation_id: match.id,
      }) } catch (_) {}
    }

    // Marquer le mouvement et la réservation
    await Promise.all([
      supabase.from('mouvement_bancaire').update({
        statut_matching: 'matche_auto',
      }).eq('id', mvt.id),
      supabase.from('reservation').update({ rapprochee: true })
        .eq('id', match.id),
    ])

    return { matched: true, raison: `SEPA manuel — ${match.code}` }
  }

  return { matched: false, raison: `SEPA : aucune réservation à ${montant}c` }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Confirme un match entre un mouvement et une liste de payouts
 * Met à jour les statuts dans Supabase
 */
async function confirmerMatch(mvt, matchedPayouts, statut, note) {
  const payoutIds = matchedPayouts.map(p => p.id)
  const reservationIds = []

  // Récupérer toutes les réservations liées à ces payouts
  for (const payoutId of payoutIds) {
    const { data: liens } = await supabase
      .from('payout_reservation')
      .select('reservation_id')
      .eq('payout_id', payoutId)

    if (liens) reservationIds.push(...liens.map(l => l.reservation_id))
  }

  // Mettre à jour le mouvement bancaire
  await supabase.from('mouvement_bancaire').update({
    statut_matching: statut,
  }).eq('id', mvt.id)

  // Mettre à jour les payouts
  if (payoutIds.length > 0) {
    await supabase.from('payout_hospitable')
      .update({ statut_matching: statut, mouvement_id: mvt.id })
      .in('id', payoutIds)
  }

  // Marquer les réservations comme rapprochées
  if (reservationIds.length > 0) {
    await supabase.from('reservation')
      .update({ rapprochee: true })
      .in('id', reservationIds)

    // Lier les réservations au mouvement dans la ventilation
    await supabase.from('ventilation')
      .update({ mouvement_id: mvt.id })
      .in('reservation_id', reservationIds)
  }

  return { matched: true, raison: note, payoutIds, reservationIds }
}

/**
 * Algorithme subset sum pour les virements Airbnb groupés
 * Cherche toutes les combinaisons de payouts dont la somme = montant cible ±2 centimes
 *
 * @param {Array} payouts - Payouts Airbnb disponibles
 * @param {number} cible - Montant cible en centimes
 * @param {Date} dateMvt - Date du virement
 * @param {number} maxItems - Limite pour éviter explosion combinatoire
 * @returns {{ found: boolean, combinations: Array[][] }}
 */
function subsetSum(payouts, cible, dateMvt, maxItems = 8) {
  const TOLERANCE = 2 // ±2 centimes
  const MAX_JOURS = 7 // fenêtre temporelle élargie pour les groupés

  // Filtrer les payouts dans la fenêtre temporelle
  const candidats = payouts.filter(p => {
    const dp = new Date(p.date_payout)
    const ecartJours = Math.abs((dp - dateMvt) / (1000 * 60 * 60 * 24))
    return ecartJours <= MAX_JOURS
  })

  if (candidats.length === 0) return { found: false, combinations: [] }
  if (candidats.length > maxItems) {
    // Trop de candidats — limiter aux plus proches en date
    candidats.sort((a, b) => {
      const da = Math.abs(new Date(a.date_payout) - dateMvt)
      const db = Math.abs(new Date(b.date_payout) - dateMvt)
      return da - db
    })
    candidats.splice(maxItems)
  }

  const combinations = []

  // Backtracking pour trouver toutes les combinaisons valides
  function backtrack(start, current, currentSum) {
    if (Math.abs(currentSum - cible) <= TOLERANCE) {
      if (current.length >= 2) { // Un groupé a au moins 2 payouts
        combinations.push([...current])
        if (combinations.length >= 5) return // Limiter à 5 propositions
      }
    }

    if (currentSum > cible + TOLERANCE) return // Pruning
    if (combinations.length >= 5) return

    for (let i = start; i < candidats.length; i++) {
      current.push(candidats[i])
      backtrack(i + 1, current, currentSum + candidats[i].amount)
      current.pop()
    }
  }

  backtrack(0, [], 0)

  return { found: combinations.length > 0, combinations }
}

/**
 * Subset sum sur réservations (fallback sans payouts)
 */
function subsetSumResas(resas, cible) {
  const TOLERANCE = 2
  // Cherche une combinaison unique dont la somme = cible ±2c
  // D'abord match exact sur 1 resa
  const direct = resas.find(r => Math.abs((r.fin_revenue||0) - cible) <= TOLERANCE)
  if (direct) return { found: true, resas: [direct] }
  // Puis combinaisons de 2-4 resas
  for (let size = 2; size <= 4; size++) {
    const result = findCombination(resas, cible, size, TOLERANCE)
    if (result) return { found: true, resas: result }
  }
  return { found: false, resas: [] }
}

function findCombination(resas, cible, size, tol) {
  function bt(start, current, sum) {
    if (current.length === size) {
      return Math.abs(sum - cible) <= tol ? [...current] : null
    }
    for (let i = start; i < resas.length; i++) {
      current.push(resas[i])
      const r = bt(i + 1, current, sum + (resas[i].fin_revenue||0))
      current.pop()
      if (r) return r
    }
    return null
  }
  return bt(0, [], 0)
}

/**
 * Confirme un match virement ↔ réservations directes (sans payouts)
 */
async function confirmerMatchResa(mvt, resas, statut, note) {
  const resaIds = resas.map(r => r.id)

  await supabase.from('mouvement_bancaire').update({
    statut_matching: statut,
    note_matching: note,
  }).eq('id', mvt.id)

  if (resaIds.length > 0) {
    await supabase.from('reservation')
      .update({ rapprochee: true })
      .in('id', resaIds)

    await supabase.from('ventilation')
      .update({ mouvement_id: mvt.id })
      .in('reservation_id', resaIds)
  }

  return { matched: true, raison: note, reservationIds: resaIds }
}

// ============================================================
// VALIDATION MANUELLE
// ============================================================

/**
 * Confirme manuellement un match entre un mouvement et des payouts
 * @param {string} mouvementId
 * @param {string[]} payoutIds
 */

// ── Générer la liste des mois ──────────────────────────────────────────────────
function allMoisDepuis2022() {
  const mois = []
  const now = new Date()
  let y = 2022, m = 1
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    mois.push(`${y}-${String(m).padStart(2,'0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return mois
}

// ── Handler principal ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey' } })
  }

  supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const log = { biens: null, resas: null, payouts: null, vent: null, matching: null, errors: [] }
  const body = await req.json().catch(() => ({}))
  const moisDebut = body.mois_debut || '2022-01'
  const moisFin   = body.mois_fin   || new Date().toISOString().slice(0,7)
  const allMois = allMoisDepuis2022().filter(m => m >= moisDebut && m <= moisFin)

  try {
    // 1. Sync biens ──────────────────────────────────────────────────────────
    const properties = await fetchProperties()
    for (const prop of properties) {
      await supabase.from('bien').update({
        hospitable_name: prop.name,
        listed: prop.listed ?? true,
      }).eq('hospitable_id', prop.id)
    }
    log.biens = `${properties.length} biens vérifiés`

    // Récupérer les biens actifs DCB
    const { data: biens } = await supabase
      .from('bien')
      .select('id, hospitable_id, hospitable_name, proprietaire_id, provision_ae_ref, forfait_dcb_ref, has_ae, taux_commission_override, gestion_loyer, agence, proprietaire(id, taux_commission)')
      .not('hospitable_id', 'is', null)
      .eq('agence', 'dcb')

    const bienByHospId = Object.fromEntries((biens || []).map(b => [b.hospitable_id, b]))
    const hospIds = (biens || []).map(b => b.hospitable_id).filter(Boolean)

    // 2. Sync réservations par blocs de 3 mois ────────────────────────────────
    let resaTotal = 0
    for (let i = 0; i < allMois.length; i += 3) {
      const chunk = allMois.slice(i, i + 3)
      const startDate = chunk[0] + '-01'
      const lastM = chunk[chunk.length - 1]
      const [ly, lm] = lastM.split('-').map(Number)
      const endDate = `${lastM}-${new Date(ly, lm, 0).getDate()}`

      try {
        const resas = await fetchReservations(hospIds, { startDate, endDate })
        for (const resa of resas) {
          const bien = bienByHospId[resa.property_id]
          if (!bien) continue
          const moisC = resa.arrival_date?.substring(0, 7) || chunk[0]
          const parsed = parseReservation(resa, bien, moisC)
          const { data: ups, error } = await supabase
            .from('reservation').upsert(parsed, { onConflict: 'hospitable_id' }).select('id').single()
          if (error) { log.errors.push('resa:' + error.message); continue }
          if (resa.financials?.host) await syncReservationFees(ups.id, resa.financials.host)
          resaTotal++
        }
      } catch(e) { log.errors.push('chunk ' + chunk[0] + ':' + e.message) }
    }
    log.resas = `${resaTotal} réservations syncées`

    // 3. Sync payouts ─────────────────────────────────────────────────────────
    let payoutsTotal = 0
    for (const mois of allMois) {
      try {
        const payouts = await fetchPayoutsForMonth(mois)
        for (const p of payouts) {
          await supabase.from('payout_hospitable').upsert({
            hospitable_id: String(p.id),
            mois_payout: mois,
            amount: p.amount,
            currency: p.currency || 'EUR',
            paid_at: p.paid_at || p.payout_date,
            canal: 'airbnb',
            raw: p,
          }, { onConflict: 'hospitable_id', ignoreDuplicates: true })
          payoutsTotal++
        }
      } catch(e) { /* mois sans payouts */ }
    }
    log.payouts = `${payoutsTotal} payouts`

    // 4. Ventilation ──────────────────────────────────────────────────────────
    let ventTotal = 0, ventErrors = 0
    for (const mois of allMois) {
      const { data: resas } = await supabase
        .from('reservation')
        .select(`*, bien(id, proprietaire_id, provision_ae_ref, forfait_dcb_ref, has_ae, taux_commission_override, gestion_loyer, agence, proprietaire(id, taux_commission)), reservation_fee(*)`)
        .eq('mois_comptable', mois)
        .eq('ventilation_calculee', false)
        .neq('final_status', 'cancelled')
      for (const resa of (resas || [])) {
        try { await calculerVentilationResa(resa); ventTotal++ }
        catch(e) { ventErrors++; log.errors.push('vent:' + resa.code + ':' + e.message) }
      }
    }
    log.vent = `${ventTotal} ventilées${ventErrors ? ', ' + ventErrors + ' erreurs' : ''}`

    // 5. Matching ─────────────────────────────────────────────────────────────
    let matchTotal = 0
    for (const mois of allMois) {
      try {
        const r = await lancerMatching(mois)
        matchTotal += r?.matched || 0
      } catch(e) { /* mois sans mouvements */ }
    }
    log.matching = `${matchTotal} rapprochés`

    return new Response(JSON.stringify({ success: true, log }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message, log }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})
