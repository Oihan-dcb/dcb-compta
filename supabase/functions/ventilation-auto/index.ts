/**
 * Edge Function — ventilation-auto
 *
 * Port serveur de src/services/ventilation.js
 * Calcule et sauvegarde la ventilation pour tous les mois ouverts non clôturés.
 *
 * Body accepté : { mois?: "YYYY-MM", agence?: string, dry_run?: boolean }
 *   - mois    : forcer un mois spécifique (sinon : auto-détection mois ouverts)
 *   - agence  : défaut 'dcb'
 *   - dry_run : si true, calcule sans écrire en base
 *
 * Appelé par pg_cron chaque nuit via net.http_post.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logError } from '../_shared/logError.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}

// ── Constantes ────────────────────────────────────────────────────────────────

const TVA_RATE = 0.20
const STATUTS_NON_VENTILABLES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']
const STATUTS_VERROU_FACTURE = ['envoye_evoliz']

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fee { label: string; amount: number; fee_type: string }
interface Bien {
  id: string
  proprietaire_id: string
  agence: string | null
  provision_ae_ref: number
  forfait_dcb_ref: number
  has_ae: boolean
  taux_commission_override: number | null
  gestion_loyer: boolean | null
  proprietaire: { id: string; taux_commission: number | null } | null
}
interface Resa {
  id: string
  code: string
  platform: string
  final_status: string
  fin_revenue: number
  fin_accommodation: number | null
  fin_discount: number | null
  mois_comptable: string
  arrival_date: string
  departure_date: string
  guest_name: string | null
  owner_stay: boolean
  bien_id: string
  bien: Bien | null
  reservation_fee: Fee[]
  reservation_ajustement: { montant: number; type: string | null; statut: string; montant_fmen: number | null; montant_auto: number | null }[]
  hospitable_raw: Record<string, unknown> | null
  isProlongation?: boolean
  originalResaId?: string | null
}
interface LigneVentilation {
  reservation_id: string
  bien_id: string
  proprietaire_id: string
  code: string
  libelle: string
  montant_ht: number
  taux_tva: number
  montant_tva: number
  montant_ttc: number
  mois_comptable: string
  calcul_source: string
  taux_calcule: number | null
}

// ── Helpers lignes ────────────────────────────────────────────────────────────

function ligneTVA(
  code: string, libelle: string, montantHT: number,
  bien: Bien, resa: Resa, tauxCalcule: number | null, montantTTC: number,
): LigneVentilation {
  const ttc = montantTTC || Math.round(montantHT * (1 + TVA_RATE))
  const tva = ttc - montantHT
  return {
    reservation_id: resa.id, bien_id: bien.id, proprietaire_id: bien.proprietaire_id,
    code, libelle, montant_ht: montantHT, taux_tva: 20, montant_tva: tva,
    montant_ttc: ttc, mois_comptable: resa.mois_comptable, calcul_source: 'auto',
    taux_calcule: code === 'HON' ? tauxCalcule : null,
  }
}

function ligneHorsTVA(code: string, libelle: string, montant: number, bien: Bien, resa: Resa): LigneVentilation {
  return {
    reservation_id: resa.id, bien_id: bien.id, proprietaire_id: bien.proprietaire_id,
    code, libelle, montant_ht: montant, taux_tva: 0, montant_tva: 0,
    montant_ttc: montant, mois_comptable: resa.mois_comptable, calcul_source: 'auto',
    taux_calcule: null,
  }
}

// ── Calcul pur (port de _calculerLignes) ─────────────────────────────────────

function _calculerLignes(resa: Resa): { lignes: LigneVentilation[]; isProlongation: boolean; fallbackAirbnb: unknown } {
  const bien = resa.bien!
  if ((bien.agence || 'dcb') !== (resa as unknown as { _agence: string })._agence) return { lignes: [], isProlongation: false, fallbackAirbnb: null }

  const revenue = resa.fin_revenue || 0
  let fees: Fee[] = resa.reservation_fee || []

  if (fees.length === 0 && (resa.hospitable_raw as Record<string, unknown>)?.financials) {
    const fin = ((resa.hospitable_raw as Record<string, unknown>)?.financials as Record<string, unknown>)?.host as Record<string, unknown> | undefined
    if (fin) {
      const LABEL_ALIASES: Record<string, string> = {
        'frais de ménage': 'cleaning fee',
        'frais de service (5%)': 'community fee',
      }
      const normalizeLabel = (l: string) => LABEL_ALIASES[l?.toLowerCase()] ?? l
      const rawHostFees = (fin.host_fees as { label: string; amount: number }[]) || []
      const rawGuestFees = (fin.guest_fees as { label: string; amount: number }[]) || []
      const rawTaxes = (fin.taxes as { label: string; amount: number }[]) || []
      fees = [
        ...rawHostFees.map(f => ({ label: normalizeLabel(f.label), amount: f.amount, fee_type: 'host_fee' })),
        ...rawGuestFees.map(f => ({ label: normalizeLabel(f.label), amount: f.amount, fee_type: 'guest_fee' })),
        ...rawTaxes.map(f => ({ label: normalizeLabel(f.label), amount: f.amount, fee_type: 'tax' })),
      ]
    }
  }

  const hostFees = fees.filter(f => f.fee_type === 'host_fee')
  const hostServiceFee = hostFees.reduce((s, f) => s + (f.amount || 0), 0)
  const guestFeesAll = fees.filter(f => f.fee_type === 'guest_fee')
  const taxes = fees.filter(f => f.fee_type === 'tax')

  // Ajustements Hospitable (Resolution Center Airbnb) : non qualifiables automatiquement
  // (hébergement ou ménage/extra ?) — voir migration 222. Contribution nulle tant que non
  // qualifié (statut≠'traite'). Détection/insertion faite par _detecterAjustements.
  const ajustementsQualifies = (resa.reservation_ajustement || []).filter(a => a.statut === 'traite')
  const ajustementHebergement = ajustementsQualifies.filter(a => a.type === 'hebergement').reduce((s, a) => s + (a.montant || 0), 0)
  const ajustementFmenExtra = ajustementsQualifies.filter(a => a.type === 'menage').reduce((s, a) => s + (a.montant_fmen || 0), 0)
  const ajustementAutoExtra = ajustementsQualifies.filter(a => a.type === 'menage').reduce((s, a) => s + (a.montant_auto || 0), 0)

  const discountsRaw = ((resa.hospitable_raw as Record<string, unknown>)?.financials as Record<string, unknown>)?.host as Record<string, unknown> | undefined
  const discountsFromApi = ((discountsRaw?.discounts as { amount: number }[]) || []).reduce((s, d) => s + (d.amount || 0), 0)
  const discountsTotal = discountsFromApi !== 0 ? discountsFromApi : -(resa.fin_discount || 0)

  const accommodation = resa.fin_accommodation || 0
  const tauxCom = bien.taux_commission_override
    || (bien.proprietaire?.taux_commission ? bien.proprietaire.taux_commission / 100 : null)
    || 0.25

  const isDirect = resa.platform === 'direct' || resa.platform === 'manual'
  const isCancelled = STATUTS_NON_VENTILABLES.includes(resa.final_status)
  const isProlongation = resa.isProlongation === true ||
    (resa.guest_name || '').toLowerCase().includes('prolongation')

  const managementFeeRaw = guestFeesAll.find(f => f.label?.toLowerCase().includes('management'))?.amount || 0
  const cleaningFeeAirbnb = guestFeesAll.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0
  const communityFeeRaw = guestFeesAll.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
  const menageBrut = resa.platform === 'airbnb' ? cleaningFeeAirbnb : communityFeeRaw
  const extraGuestFee = guestFeesAll.filter(f => f.label?.toLowerCase() === 'extra_guest_fee').reduce((s, f) => s + (f.amount || 0), 0)
  const aeAmount = (isCancelled || isProlongation || (isDirect && menageBrut === 0)) ? 0 : (bien.provision_ae_ref || 0)

  const isRemitted = (t: Fee) => t.label?.toLowerCase().includes('remitted')
  const taxesTotal = (resa.platform === 'airbnb') ? 0 : taxes.filter(t => !isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)

  const totalFeesForOwnerRate = accommodation + guestFeesAll.reduce((s, f) => s + (f.amount || 0), 0)

  const totalFeesAirbnb = cleaningFeeAirbnb + communityFeeRaw
  const airbnbFallbackActif = resa.platform === 'airbnb' && totalFeesAirbnb === 0 && (bien.forfait_dcb_ref || 0) > 0
  // Fallback Airbnb : Airbnb n'a pas transmis la ligne ménage → ménage voyageur FONDU dans
  // `accommodation`. Prix ménage facturé au voyageur = forfait_dcb_ref + provision_ae_ref (= 97,00 sur 416).
  const fmenBase = airbnbFallbackActif
    ? (bien.forfait_dcb_ref || 0) + (bien.provision_ae_ref || 0)
    : totalFeesAirbnb
  // Part du host service fee Airbnb imputée au ménage (Airbnb commissionne aussi le ménage).
  const dueToOwner = ((resa.platform === 'airbnb' || resa.platform === 'booking') && totalFeesForOwnerRate > 0)
    ? Math.round(Math.abs(hostServiceFee) * fmenBase / totalFeesForOwnerRate * (1 - tauxCom))
    : 0
  // aeAmountTotal inclut la part AUTO d'un ajustement ménage qualifié — ajoutée APRÈS le
  // pro-rata dueToOwner (qui ne concerne que le ménage standard, pas l'ajustement).
  const aeAmountTotal = aeAmount + ajustementAutoExtra
  const fmenTTC = Math.max(0, fmenBase - dueToOwner - aeAmount) + ajustementFmenExtra
  const fmenHT = fmenTTC > 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // En fallback, le ménage voyageur NET de la commission Airbnb (= fmenBase − dueToOwner) est
  // fondu dans `accommodation` → on le retranche de la base de commission, sinon HON serait
  // calculé sur le ménage. (Cas normal : le ménage est déjà hors accommodation.)
  const menageFonduAccommodation = airbnbFallbackActif ? (fmenBase - dueToOwner) : 0

  const commissionableBase = accommodation + hostServiceFee + discountsTotal + extraGuestFee - menageFonduAccommodation + ajustementHebergement
  const honTTC = isDirect ? Math.floor(commissionableBase * tauxCom) : Math.round(commissionableBase * tauxCom)
  const honHT = Math.round(honTTC / (1 + TVA_RATE))

  const menLabelsToExclude = ['management fee', 'host service fee', 'resort fee']
  const menFees = guestFeesAll.filter(f => !menLabelsToExclude.includes(f.label?.toLowerCase()))
  const menAmount = menFees.reduce((s, f) => s + (f.amount || 0), 0)

  const resortFeeRaw = guestFeesAll.find(f => f.label?.toLowerCase() === 'resort fee')?.amount || 0
  const comAmount = isDirect ? (managementFeeRaw + resortFeeRaw) : 0
  const comHT = comAmount > 0 ? Math.round(comAmount / (1 + TVA_RATE)) : 0

  const ownerFees = (isDirect && totalFeesForOwnerRate > 0)
    ? guestFeesAll.reduce((s, f) => s + Math.round(Math.abs(hostServiceFee) * (f.amount || 0) / totalFeesForOwnerRate * (1 - tauxCom)), 0)
    : 0

  let loyAmount: number
  if (isDirect) {
    loyAmount = commissionableBase - honTTC + ownerFees
  } else {
    loyAmount = revenue - honTTC - fmenTTC - aeAmountTotal - taxesTotal
  }

  if (resa.platform === 'booking') {
    const remittedTotal = taxes.filter(t => isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)
    // CITY_TAX (Withheld Tax) est déjà exclu de host.revenue.amount — ne pas déduire une 2e fois
    loyAmount = (revenue - remittedTotal) - honTTC - fmenTTC - aeAmountTotal - taxesTotal
  }

  const horsSequestre = bien.gestion_loyer === false && (resa.platform === 'airbnb' || resa.platform === 'booking')
  const virAmount = loyAmount + taxesTotal

  const lignes: LigneVentilation[] = []
  if (menAmount > 0) lignes.push(ligneHorsTVA('MEN', 'Ménage brut voyageur', menAmount, bien, resa))
  if (comHT > 0) lignes.push(ligneTVA('COM', 'Commission DCB', comHT, bien, resa, null, comAmount))
  if (honHT > 0) lignes.push(ligneTVA('HON', 'Honoraires de gestion', honHT, bien, resa, tauxCom, honTTC))
  if (fmenHT > 0) lignes.push(ligneTVA('FMEN', 'Forfait ménage', fmenHT, bien, resa, null, fmenTTC))
  if (aeAmountTotal > 0) lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', aeAmountTotal, bien, resa))
  if (loyAmount > 0 && !horsSequestre) lignes.push(ligneHorsTVA('LOY', 'Reversement propriétaire', loyAmount, bien, resa))
  if (virAmount > 0 && !horsSequestre) lignes.push(ligneHorsTVA('VIR', 'Virement propriétaire', virAmount, bien, resa))

  if (resa.platform !== 'airbnb') {
    const seen = new Set<string>()
    for (const tax of taxes) {
      if (tax.amount > 0 && !isRemitted(tax)) {
        const label = tax.label || 'Taxe séjour'
        const key = `${label}|${tax.amount}`
        if (!seen.has(key)) { seen.add(key); lignes.push(ligneHorsTVA('TAXE', label, tax.amount, bien, resa)) }
      }
    }
  }

  return { lignes, isProlongation, fallbackAirbnb: airbnbFallbackActif ? { motif: 'airbnb_fees_missing' } : null }
}

// ── Détection ajustements Hospitable (Resolution Center) — voir migration 222 ─
// Insère les nouveaux ajustements en statut 'a_qualifier' sans écraser une qualification
// existante (contrainte unique + ignoreDuplicates). _calculerLignes ne prend en compte
// que les lignes statut='traite'.

async function _detecterAjustements(resa: Resa, supa: ReturnType<typeof createClient>): Promise<void> {
  const fin = ((resa.hospitable_raw as Record<string, unknown>)?.financials as Record<string, unknown>)?.host as Record<string, unknown> | undefined
  const rawAdjustments = (fin?.adjustments as { label: string; amount: number }[]) || []
  const rows = rawAdjustments
    .filter(a => (a.amount || 0) !== 0)
    .map(a => ({
      reservation_id: resa.id,
      mois_comptable: resa.mois_comptable,
      montant: a.amount,
      label: a.label || null,
    }))
  if (rows.length === 0) return
  await supa.from('reservation_ajustement').upsert(rows, { onConflict: 'reservation_id,label,montant', ignoreDuplicates: true })
}

// ── calculerVentilationResa (port avec supabase admin) ────────────────────────

async function calculerVentilationResa(resa: Resa, supa: ReturnType<typeof createClient>, dryRun: boolean): Promise<void> {
  const bien = resa.bien!

  // Séjour propriétaire
  if (resa.owner_stay) {
    const men = resa.fin_revenue || 0
    const autoHT = bien.provision_ae_ref || 0
    const fmenTTC = Math.max(0, men - autoHT)
    const fmenHT = Math.round(fmenTTC / (1 + TVA_RATE))
    const fmenTVA = fmenTTC - fmenHT

    if (!dryRun) {
      const { data: existingAutoReel } = await supa.from('ventilation').select('montant_reel').eq('reservation_id', resa.id).eq('code', 'AUTO').maybeSingle()
      const autoReel = existingAutoReel?.montant_reel ?? null
      await supa.from('ventilation').delete().eq('reservation_id', resa.id)
      const lignes: LigneVentilation[] = []
      if (fmenTTC > 0) lignes.push(ligneTVA('FMEN', 'Forfait ménage séjour propriétaire', fmenHT, bien, resa, null, fmenTTC))
      if (autoHT > 0 && men > 0) lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', autoHT, bien, resa))
      if (lignes.length > 0) { const { error } = await supa.from('ventilation').insert(lignes); if (error) throw error }
      if (autoReel !== null && autoHT > 0) await supa.from('ventilation').update({ montant_reel: autoReel }).eq('reservation_id', resa.id).eq('code', 'AUTO')
      await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
      const { data: ligneAuto } = await supa.from('ventilation').select('id').eq('reservation_id', resa.id).eq('code', 'AUTO').single()
      if (ligneAuto?.id) { try { await supa.rpc('lier_ventilation_auto_mission', { p_reservation_id: resa.id, p_ventilation_id: ligneAuto.id }) } catch {} }
    }
    return
  }

  // Annulée sans payout
  const isCancelled = STATUTS_NON_VENTILABLES.includes(resa.final_status)
  if (isCancelled && parseFloat(String(resa.fin_revenue || 0)) === 0) {
    if (!dryRun) {
      await supa.from('ventilation').delete().eq('reservation_id', resa.id)
      await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    }
    return
  }

  const revenue = resa.fin_revenue || 0
  if (revenue === 0) {
    if (!dryRun) await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return
  }

  if (!dryRun) await _detecterAjustements(resa, supa)

  const { lignes, isProlongation } = _calculerLignes(resa)

  if (dryRun) return

  // Sauvegarder montant_reel + mouvement_id avant suppression
  const { data: existingLines } = await supa.from('ventilation').select('id, code, montant_reel, mouvement_id').eq('reservation_id', resa.id)
  const existingReels: Record<string, number> = {}
  const existingMouvements: Record<string, string> = {}
  for (const l of existingLines || []) {
    if (l.montant_reel != null) existingReels[l.code] = l.montant_reel
    if (l.mouvement_id != null) existingMouvements[l.code] = l.mouvement_id
  }

  // Migration mission_menage si prolongation
  let missionToMigrate: string | null = null
  let autoMontantReel: number | null = null
  if (isProlongation) {
    const existingAuto = (existingLines || []).find(l => l.code === 'AUTO')
    if (existingAuto) {
      autoMontantReel = existingAuto.montant_reel
      const { data: mission } = await supa.from('mission_menage').select('id').eq('ventilation_auto_id', existingAuto.id).maybeSingle()
      missionToMigrate = mission?.id || null
    }
  }

  const { error: delErr } = await supa.from('ventilation').delete().eq('reservation_id', resa.id)
  if (delErr) throw new Error(`DELETE ventilation: ${delErr.message}`)

  if (lignes.length > 0) { const { error } = await supa.from('ventilation').insert(lignes); if (error) throw error }

  // Restaurer montant_reel + mouvement_id
  const codesToRestore = new Set([...Object.keys(existingReels), ...Object.keys(existingMouvements)])
  if (isProlongation) codesToRestore.delete('AUTO')
  for (const code of codesToRestore) {
    const patch: Record<string, unknown> = {}
    if (existingReels[code] != null) patch.montant_reel = existingReels[code]
    if (existingMouvements[code] != null) patch.mouvement_id = existingMouvements[code]
    if (Object.keys(patch).length > 0) await supa.from('ventilation').update(patch).eq('reservation_id', resa.id).eq('code', code)
  }

  await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)

  // Migration prolongation
  if (isProlongation && missionToMigrate) {
    let originalResaId = resa.originalResaId || null
    if (!originalResaId) {
      const { data: originalResa } = await supa.from('reservation').select('id')
        .eq('bien_id', resa.bien_id).eq('departure_date', (resa.arrival_date || '').substring(0, 10)).neq('id', resa.id).maybeSingle()
      originalResaId = originalResa?.id || null
    }
    if (originalResaId) {
      const { data: originalAuto } = await supa.from('ventilation').select('id').eq('reservation_id', originalResaId).eq('code', 'AUTO').maybeSingle()
      if (originalAuto?.id) {
        await supa.from('mission_menage').update({ ventilation_auto_id: originalAuto.id }).eq('id', missionToMigrate)
        if (autoMontantReel != null) await supa.from('ventilation').update({ montant_reel: autoMontantReel }).eq('id', originalAuto.id)
      }
    }
  }

  // Lier mission_menage AUTO
  const { data: ligneAuto } = await supa.from('ventilation').select('id').eq('reservation_id', resa.id).eq('code', 'AUTO').single()
  if (ligneAuto?.id) { try { await supa.rpc('lier_ventilation_auto_mission', { p_reservation_id: resa.id, p_ventilation_id: ligneAuto.id }) } catch {} }
}

// ── calculerVentilationMois ────────────────────────────────────────────────────

async function calculerVentilationMois(mois: string, agence: string, supa: ReturnType<typeof createClient>, dryRun: boolean) {
  // Verrou factures
  const { data: facturesVerrouillees } = await supa.from('facture_evoliz')
    .select('proprietaire_id').eq('mois', mois).eq('type_facture', 'honoraires').in('statut', STATUTS_VERROU_FACTURE)
  const proprietairesVerrouilles = new Set((facturesVerrouillees || []).map((f: { proprietaire_id: string }) => f.proprietaire_id).filter(Boolean))

  // Supprimer ventilations orphelines
  const { data: resasCancelleesIds } = await supa.from('reservation').select('id')
    .eq('mois_comptable', mois)
    .in('final_status', ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired'])
    .or('fin_revenue.is.null,fin_revenue.eq.0')
  if (resasCancelleesIds?.length && !dryRun) {
    await supa.from('ventilation').delete().in('reservation_id', resasCancelleesIds.map((r: { id: string }) => r.id))
  }

  // Charger réservations
  const { data: reservations, error } = await supa.from('reservation').select(`
    *,
    bien (
      id, proprietaire_id,
      provision_ae_ref, forfait_dcb_ref, has_ae,
      taux_commission_override, gestion_loyer, agence,
      proprietaire!proprietaire_id (id, taux_commission)
    ),
    reservation_fee (*),
    reservation_ajustement (*)
  `)
    .eq('mois_comptable', mois)
    .or('fin_revenue.gt.0,final_status.not.in.("cancelled","not_accepted","not accepted","declined","expired")')

  if (error) throw error

  // Détection prolongations (critère A)
  const resasByBienGuest: Record<string, Resa[]> = {}
  for (const r of (reservations || []) as Resa[]) {
    const key = `${r.bien_id}|${(r.guest_name || '').toLowerCase().trim()}`
    if (!resasByBienGuest[key]) resasByBienGuest[key] = []
    resasByBienGuest[key].push(r)
  }
  for (const group of Object.values(resasByBienGuest)) {
    if (group.length < 2) continue
    for (const r of group) {
      const fees = r.reservation_fee || []
      const cleaningFee = fees.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0
      const communityFee = fees.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
      // Pour les réservations manuelles, le community fee est la commission DCB, pas un frais ménage
      const blocksProlongation = cleaningFee > 0 || ((r as any).platform !== 'manual' && communityFee > 0)
      if (blocksProlongation) continue
      const preceding = group.find(other => other.id !== r.id && (other.departure_date || '').substring(0, 10) === (r.arrival_date || '').substring(0, 10))
      if (preceding) { r.isProlongation = true; r.originalResaId = preceding.id }
    }
  }

  // Injecter agence dans chaque resa pour _calculerLignes
  const resasFiltrees = ((reservations || []) as Resa[]).filter(r => r.bien != null && (r.bien.agence || agence) === agence)

  let total = 0, errors = 0, skipped = 0
  const errorDetails: { code: string; msg: string }[] = []

  for (const resa of resasFiltrees) {
    if (proprietairesVerrouilles.has(resa.bien?.proprietaire_id || '')) { skipped++; continue }
    // Injecter agence pour _calculerLignes
    ;(resa as unknown as { _agence: string })._agence = agence
    try {
      await calculerVentilationResa(resa, supa, dryRun)
      total++
    } catch (err) {
      errorDetails.push({ code: resa.code, msg: (err as Error).message })
      errors++
    }
  }

  // Log
  if (!dryRun) {
    await supa.from('journal').insert({
      categorie: 'ventilation', action: 'compute_auto', mois_comptable: mois,
      statut: errors > 0 ? 'warning' : 'ok', source: 'cron',
      message: `Ventilation auto ${mois} : ${total} résa(s)${skipped > 0 ? ', ' + skipped + ' verrouillée(s)' : ''}${errors > 0 ? ', ' + errors + ' erreur(s)' : ''}`,
      meta: { total, skipped, errors, errorDetails },
    }).catch(() => {})
  }

  return { mois, total, skipped, errors, errorDetails }
}

// ── Handler principal ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const agence = Deno.env.get('AGENCE') || 'dcb'
  const supa = createClient(supaUrl, supaKey)

  let body: { mois?: string; agence?: string; dry_run?: boolean } = {}
  try { body = await req.json() } catch {}

  const dryRun = body.dry_run === true
  const agenceTarget = body.agence || agence

  // Déterminer les mois à traiter
  let moisList: string[] = []

  if (body.mois) {
    moisList = [body.mois]
  } else {
    // Auto : tous les mois ayant des réservations avec revenue (passés ET futurs),
    // hors mois clôturés (cloture_ventil = true)
    const { data: moisAvecResas } = await supa.from('reservation')
      .select('mois_comptable')
      .gt('fin_revenue', 0)
      .not('mois_comptable', 'is', null)
    const moisUniques = [...new Set((moisAvecResas || []).map((r: { mois_comptable: string }) => r.mois_comptable))]

    if (moisUniques.length > 0) {
      const { data: clotures } = await supa.from('cloture_comptable')
        .select('mois').eq('agence', agenceTarget).eq('cloture_ventil', true).in('mois', moisUniques)
      const moisClos = new Set((clotures || []).map((c: { mois: string }) => c.mois))
      moisList = moisUniques.filter(m => !moisClos.has(m)).sort()
    }
  }

  if (moisList.length === 0) {
    return jsonResp({ ok: true, message: 'Aucun mois ouvert à ventiler', resultats: [] })
  }

  const resultats = []
  for (const mois of moisList) {
    try {
      const res = await calculerVentilationMois(mois, agenceTarget, supa, dryRun)
      resultats.push(res)
    } catch (err) {
      await logError({ source: 'edge_ventilation-auto', message: (err as Error).message, stack: (err as Error).stack, context: { mois } })
      resultats.push({ mois, error: (err as Error).message })
    }
  }

  return jsonResp({ ok: true, dry_run: dryRun, agence: agenceTarget, mois_traites: moisList, resultats })
})
