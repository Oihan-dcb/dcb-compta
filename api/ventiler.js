/**
 * POST /api/ventiler
 *
 * Port serveur Node.js de src/services/ventilation.js
 * Utilise la clé service_role pour bypasser les RLS — les calculs DB ne sont
 * jamais bloqués par une politique anon/authenticated.
 *
 * Body :
 *   { mois: 'YYYY-MM', agence?: 'dcb' }
 *     → ventile toutes les réservations du mois
 *     → retourne { ok, total, skipped, errors, errorDetails, prolongations }
 *
 *   { reservation_id: 'uuid', agence?: 'dcb' }
 *     → recalcule une réservation individuelle
 *     → retourne { ok: true }
 *
 * Auth : Bearer JWT Supabase valide requis (tout utilisateur authentifié).
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SRK      = process.env.SUPABASE_SERVICE_ROLE_KEY

const TVA_RATE = 0.20
const STATUTS_NON_VENTILABLES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']
const STATUTS_VERROU_FACTURE  = ['envoye_evoliz']

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyToken(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
  })
  return r.ok
}

// ── Helpers lignes ────────────────────────────────────────────────────────────

function ligneTVA(code, libelle, montantHT, bien, resa, tauxCalcule, montantTTC) {
  const ttc = montantTTC || Math.round(montantHT * (1 + TVA_RATE))
  const tva = ttc - montantHT
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code, libelle,
    montant_ht: montantHT, taux_tva: 20, montant_tva: tva, montant_ttc: ttc,
    mois_comptable: resa.mois_comptable, calcul_source: 'auto',
    taux_calcule: code === 'HON' ? tauxCalcule : null,
  }
}

function ligneHorsTVA(code, libelle, montant, bien, resa) {
  return {
    reservation_id: resa.id,
    bien_id: bien.id,
    proprietaire_id: bien.proprietaire_id,
    code, libelle,
    montant_ht: montant, taux_tva: 0, montant_tva: 0, montant_ttc: montant,
    mois_comptable: resa.mois_comptable, calcul_source: 'auto',
    taux_calcule: null,
  }
}

// ── Calcul pur (port exact de _calculerLignes) ────────────────────────────────

function _calculerLignes(resa, agence) {
  const bien = resa.bien
  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)
  if ((bien.agence || agence) !== agence) return { lignes: [], isProlongation: false, fallbackAirbnb: null }

  const revenue = resa.fin_revenue || 0

  let fees = resa.reservation_fee || []

  if (fees.length === 0 && resa.hospitable_raw?.financials?.host) {
    const fin = resa.hospitable_raw.financials.host
    const rawHostFees  = fin.host_fees  || []
    const rawGuestFees = fin.guest_fees || []
    const rawTaxes     = fin.taxes      || []
    const LABEL_ALIASES = {
      'frais de ménage':       'cleaning fee',
      'frais de service (5%)': 'community fee',
    }
    const normalizeLabel = l => LABEL_ALIASES[l?.toLowerCase()] ?? l
    fees = [
      ...rawHostFees.map(f  => ({ label: normalizeLabel(f.label),  amount: f.amount, fee_type: 'host_fee' })),
      ...rawGuestFees.map(f => ({ label: normalizeLabel(f.label),  amount: f.amount, fee_type: 'guest_fee' })),
      ...rawTaxes.map(f     => ({ label: normalizeLabel(f.label),  amount: f.amount, fee_type: 'tax' })),
    ]
  }

  const hostFees       = fees.filter(f => f.fee_type === 'host_fee')
  const hostServiceFee = hostFees.reduce((s, f) => s + (f.amount || 0), 0)
  const guestFeesAll   = fees.filter(f => f.fee_type === 'guest_fee')
  const taxes          = fees.filter(f => f.fee_type === 'tax')

  // Ajustements Hospitable (Resolution Center Airbnb, ex. remboursement partiel) : montant
  // signé, non qualifiable automatiquement (hébergement ou ménage/extra ?) → voir migration
  // 222. Tant que non qualifié (statut≠'traite'), contribution nulle au calcul (comportement
  // identique à avant leur prise en compte) ; la détection/alerte est gérée par _writeResa.
  // Ménage/extra : montant_fmen saisi manuellement (migration 224) augmente le FMEN de DCB.
  // montant_auto n'entre dans AUCUN calcul (stocké pour information seulement) : la vraie
  // rémunération AE passe par une prestation_hors_forfait réelle saisie séparément (liée à
  // mission_menage), jamais par cette ligne — sinon double paiement AE. Le reliquat de
  // l'ajustement non absorbé par montant_fmen (= revenue déjà augmenté du montant brut, non
  // compensé par fmenTTC) remonte naturellement au propriétaire via le résidu LOY, où il
  // s'annule avec la déduction de la prestation réelle (ex. Shelly : +75 ajustement, +56,25
  // FMEN → +18,75 résiduel au LOY, qui compense exactement les -18,75 de la prestation
  // "Recouche" déduite par ailleurs — net propriétaire = 0).
  const ajustementsQualifies = (resa.reservation_ajustement || []).filter(a => a.statut === 'traite')
  const ajustementHebergement = ajustementsQualifies
    .filter(a => a.type === 'hebergement').reduce((s, a) => s + (a.montant || 0), 0)
  const ajustementFmenExtra = ajustementsQualifies
    .filter(a => a.type === 'menage').reduce((s, a) => s + (a.montant_fmen || 0), 0)

  const discountsRaw    = resa.hospitable_raw?.financials?.host?.discounts || []
  const discountsFromApi = discountsRaw.reduce((s, d) => s + (d.amount || 0), 0)
  const discountsTotal   = discountsFromApi !== 0 ? discountsFromApi : -(resa.fin_discount || 0)

  const accommodation = resa.fin_accommodation || 0
  const tauxCom = bien.taux_commission_override
    || (bien.proprietaire?.taux_commission ? bien.proprietaire.taux_commission / 100 : null)
    || 0.25

  const isDirect     = resa.platform === 'direct' || resa.platform === 'manual'
  const isCancelled  = STATUTS_NON_VENTILABLES.includes(resa.final_status)
  const isProlongation = resa.isProlongation === true ||
    (resa.guest_name || '').toLowerCase().includes('prolongation')

  const managementFeeRaw  = guestFeesAll.find(f => f.label?.toLowerCase().includes('management'))?.amount || 0
  const cleaningFeeAirbnb = guestFeesAll.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0
  const communityFeeRaw   = guestFeesAll.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
  const menageBrut        = resa.platform === 'airbnb' ? cleaningFeeAirbnb : communityFeeRaw
  const extraGuestFee     = guestFeesAll
    .filter(f => f.label?.toLowerCase() === 'extra_guest_fee')
    .reduce((s, f) => s + (f.amount || 0), 0)

  const aeAmount = (isCancelled || isProlongation || (isDirect && menageBrut === 0))
    ? 0 : (bien.provision_ae_ref || 0)

  const isRemitted = t => t.label?.toLowerCase().includes('remitted')
  const taxesTotal = resa.platform === 'airbnb'
    ? 0
    : taxes.filter(t => !isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)

  const totalFeesForOwnerRate = accommodation + guestFeesAll.reduce((s, f) => s + (f.amount || 0), 0)

  const totalFeesAirbnb    = cleaningFeeAirbnb + communityFeeRaw
  const airbnbFallbackActif = resa.platform === 'airbnb' && totalFeesAirbnb === 0 && (bien.forfait_dcb_ref || 0) > 0
  // Fallback Airbnb : Airbnb n'a pas transmis la ligne ménage → le ménage voyageur est FONDU
  // dans `accommodation`. Prix ménage facturé au voyageur = forfait_dcb_ref + provision_ae_ref
  // (vérifié : 97,00 = 72,00 + 25,00 sur le 416).
  const fmenBase = airbnbFallbackActif
    ? (bien.forfait_dcb_ref || 0) + (bien.provision_ae_ref || 0)
    : totalFeesAirbnb
  // Part du host service fee Airbnb imputée au ménage (Airbnb commissionne aussi le ménage).
  const dueToOwner = ((resa.platform === 'airbnb' || resa.platform === 'booking') && totalFeesForOwnerRate > 0)
    ? Math.round(Math.abs(hostServiceFee) * fmenBase / totalFeesForOwnerRate * (1 - tauxCom))
    : 0
  let fmenTTC = Math.max(0, fmenBase - dueToOwner - aeAmount) + ajustementFmenExtra
  // fmenHT peut être négatif si ajustementFmenExtra dépasse la marge FMEN normale (DCB
  // absorbe la perte) — pas de floor à 0 ici, pour que HON+FMEN+AUTO+LOY se recoupe exactement.
  let fmenHT  = fmenTTC !== 0 ? Math.round(fmenTTC / (1 + TVA_RATE)) : 0

  // En fallback, le ménage voyageur NET de la commission Airbnb (= fmenBase − dueToOwner) est
  // fondu dans `accommodation` → on le retranche de la base de commission, sinon HON serait
  // calculé sur le ménage. (Cas normal : le ménage est déjà hors accommodation.)
  const menageFonduAccommodation = airbnbFallbackActif ? (fmenBase - dueToOwner) : 0

  const commissionableBase = accommodation + hostServiceFee + discountsTotal + extraGuestFee - menageFonduAccommodation + ajustementHebergement
  let honTTC = isDirect
    ? Math.floor(commissionableBase * tauxCom)
    : Math.round(commissionableBase * tauxCom)
  let honHT = Math.round(honTTC / (1 + TVA_RATE))

  // skip_facturation : bien perso du gérant (ex. LAGREOU/ASKIDA) — aucun honoraire ni
  // forfait ménage ne doit être prélevé, pas juste "non facturé" (cf. facturesLLD.js).
  // Le revenu correspondant remonte intégralement au propriétaire via LOY/VIR ci-dessous.
  if (bien.skip_facturation) {
    honHT = 0; honTTC = 0; fmenHT = 0; fmenTTC = 0
  }

  const menLabelsToExclude = ['management fee', 'host service fee', 'resort fee']
  const menFees   = guestFeesAll.filter(f => !menLabelsToExclude.includes(f.label?.toLowerCase()))
  const menAmount = menFees.reduce((s, f) => s + (f.amount || 0), 0)

  const resortFeeRaw = guestFeesAll.find(f => f.label?.toLowerCase() === 'resort fee')?.amount || 0
  const comAmount    = isDirect ? (managementFeeRaw + resortFeeRaw) : 0
  const comHT        = comAmount > 0 ? Math.round(comAmount / (1 + TVA_RATE)) : 0

  const ownerFees = (isDirect && totalFeesForOwnerRate > 0)
    ? guestFeesAll.reduce((s, f) => s + Math.round(Math.abs(hostServiceFee) * (f.amount || 0) / totalFeesForOwnerRate * (1 - tauxCom)), 0)
    : 0

  let loyAmount
  if (isDirect) {
    loyAmount = commissionableBase - honTTC + ownerFees
  } else {
    loyAmount = revenue - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  if (resa.platform === 'booking') {
    const remittedTotal = taxes.filter(t => isRemitted(t)).reduce((s, t) => s + (t.amount || 0), 0)
    // CITY_TAX (Withheld Tax) est déjà exclu de host.revenue.amount — ne pas déduire une 2e fois
    loyAmount = (revenue - remittedTotal) - honTTC - fmenTTC - aeAmount - taxesTotal
  }

  const horsSequestre = bien.gestion_loyer === false
    && (resa.platform === 'airbnb' || resa.platform === 'booking')

  const lignes = []

  if (menAmount > 0)
    lignes.push(ligneHorsTVA('MEN',  'Ménage brut voyageur',       menAmount, bien, resa))
  if (comHT > 0)
    lignes.push(ligneTVA(    'COM',  'Commission DCB',              comHT,     bien, resa, null,        comAmount))
  if (honHT > 0)
    lignes.push(ligneTVA(    'HON',  'Honoraires de gestion',       honHT,     bien, resa, tauxCom,     honTTC))
  if (fmenHT !== 0)
    lignes.push(ligneTVA(    'FMEN', 'Forfait ménage',              fmenHT,    bien, resa, null,        fmenTTC))
  // Ligne AUTO créée même à 0 quand il y a un ménage : provision_ae_ref absent ≠ coût nul,
  // la ligne sert d'ancrage aux missions réelles (lier_ventilation_auto_mission +
  // update-ventilation-auto qui pose montant_reel et le FMEN réel dérivé).
  if (aeAmount > 0 || menAmount > 0)
    lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur',   aeAmount,  bien, resa))
  if (loyAmount > 0 && !horsSequestre)
    lignes.push(ligneHorsTVA('LOY',  'Reversement propriétaire',   loyAmount,  bien, resa))

  const virAmount = loyAmount + taxesTotal
  if (virAmount > 0 && !horsSequestre)
    lignes.push(ligneHorsTVA('VIR',  'Virement propriétaire',       virAmount, bien, resa))

  if (resa.platform !== 'airbnb') {
    const seen = new Set()
    for (const tax of taxes) {
      if (tax.amount > 0 && !isRemitted(tax)) {
        const label = tax.label || 'Taxe séjour'
        const key   = `${label}|${tax.amount}`
        if (!seen.has(key)) {
          seen.add(key)
          lignes.push(ligneHorsTVA('TAXE', label, tax.amount, bien, resa))
        }
      }
    }
  }

  return {
    lignes, isProlongation,
    fallbackAirbnb: airbnbFallbackActif ? {
      motif: 'airbnb_fees_missing',
      forfait_dcb_ref: bien.forfait_dcb_ref,
      provision_ae_ref: bien.provision_ae_ref || 0,
      fmenBase,
    } : null,
  }
}

// ── Détection ajustements Hospitable (Resolution Center) — voir migration 222 ─
// Insère les nouveaux ajustements en statut 'a_qualifier' (jamais écrasé si déjà qualifié,
// grâce à la contrainte unique + ignoreDuplicates). Ne touche pas au calcul lui-même :
// _calculerLignes ne prend en compte que les lignes statut='traite'.

async function _detecterAjustements(resa, supa) {
  const rawAdjustments = resa.hospitable_raw?.financials?.host?.adjustments || []
  const rows = rawAdjustments
    .filter(a => (a.amount || 0) !== 0)
    .map(a => ({
      reservation_id: resa.id,
      mois_comptable: resa.mois_comptable,
      montant: a.amount,
      label: a.label || null,
    }))
  if (rows.length === 0) return
  await supa.from('reservation_ajustement')
    .upsert(rows, { onConflict: 'reservation_id,label,montant', ignoreDuplicates: true })
}

// ── Ecriture DB d'une réservation (port de calculerVentilationResa) ───────────

async function _writeResa(resa, agence, supa) {
  // Verrou ajustement manuel : la ventilation de cette résa a été saisie à la main
  // (modal Réservations, migration 226) — ne JAMAIS l'écraser par un recalcul auto.
  if (resa.ventilation_manuelle) return
  const bien = resa.bien
  if (!bien) throw new Error(`Bien manquant pour résa ${resa.code}`)
  if ((bien.agence || agence) !== agence) return

  // Séjour propriétaire
  if (resa.owner_stay) {
    const men     = resa.fin_revenue || 0
    const autoHT  = bien.provision_ae_ref || 0
    const fmenTTC = Math.max(0, men - autoHT)
    const fmenHT  = Math.round(fmenTTC / (1 + TVA_RATE))

    const { data: existingAutoReel } = await supa.from('ventilation')
      .select('montant_reel').eq('reservation_id', resa.id).eq('code', 'AUTO').maybeSingle()
    const autoReel = existingAutoReel?.montant_reel ?? null

    await supa.from('ventilation').delete().eq('reservation_id', resa.id)
    const lignes = []
    if (fmenTTC > 0) lignes.push(ligneTVA('FMEN', 'Forfait ménage séjour propriétaire', fmenHT, bien, resa, null, fmenTTC))
    // Ligne AUTO même à 0 (cf. règle provision_ae_ref absent = info manquante, pas coût nul)
    if (men > 0) lignes.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', autoHT, bien, resa))
    if (lignes.length > 0) {
      const { error } = await supa.from('ventilation').insert(lignes)
      if (error) throw error
    }
    if (autoReel !== null && men > 0)
      await supa.from('ventilation').update({ montant_reel: autoReel }).eq('reservation_id', resa.id).eq('code', 'AUTO')
    await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    const { data: ligneAuto } = await supa.from('ventilation').select('id')
      .eq('reservation_id', resa.id).eq('code', 'AUTO').single()
    if (ligneAuto?.id) {
      try { await supa.rpc('lier_ventilation_auto_mission', { p_reservation_id: resa.id, p_ventilation_id: ligneAuto.id }) } catch {}
    }
    return
  }

  // Annulée sans payout
  const isCancelled = STATUTS_NON_VENTILABLES.includes(resa.final_status)
  if (isCancelled && parseFloat(resa.fin_revenue || 0) === 0) {
    await supa.from('ventilation').delete().eq('reservation_id', resa.id)
    await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return
  }

  const revenue = resa.fin_revenue || 0
  if (revenue === 0) {
    await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return
  }

  await _detecterAjustements(resa, supa)

  const { lignes, fallbackAirbnb, isProlongation } = _calculerLignes(resa, agence)

  // Logs journal
  if (isProlongation) {
    supa.from('journal_ops').insert({
      categorie: 'ventilation', action: 'prolongation_detected', source: 'app', statut: 'ok',
      mois_comptable: resa.mois_comptable,
      message: `Prolongation détectée : AUTO/FMEN supprimés, mission ménage à migrer vers résa originale`,
      meta: { code: resa.code, bien: resa.bien?.code, originalResaId: resa.originalResaId || null },
    }).then(null, () => {})
  }
  if (fallbackAirbnb) {
    supa.from('journal_ops').insert({
      categorie: 'ventilation', action: 'fallback_airbnb', source: 'app', statut: 'ok',
      mois_comptable: resa.mois_comptable,
      message: `Fallback Airbnb activé : aucun frais ménage dans reservation_fee, fmenBase reconstruit depuis le bien`,
      meta: {
        code: resa.code, bien: resa.bien?.code || resa.bien_id,
        motif: fallbackAirbnb.motif, forfait_dcb_ref: fallbackAirbnb.forfait_dcb_ref,
        provision_ae_ref: fallbackAirbnb.provision_ae_ref, fmenBase: fallbackAirbnb.fmenBase,
      },
    }).then(null, () => {})
  }

  // Sauvegarder montant_reel + mouvement_id avant suppression
  const { data: existingLines } = await supa.from('ventilation')
    .select('id, code, montant_reel, mouvement_id').eq('reservation_id', resa.id)
  const existingReels     = {}
  const existingMouvements = {}
  for (const l of existingLines || []) {
    if (l.montant_reel  != null) existingReels[l.code]      = l.montant_reel
    if (l.mouvement_id  != null) existingMouvements[l.code] = l.mouvement_id
  }

  // Mission ménage sur prolongation
  let missionToMigrate = null
  let autoMontantReel  = null
  if (isProlongation) {
    const existingAuto = (existingLines || []).find(l => l.code === 'AUTO')
    if (existingAuto) {
      autoMontantReel = existingAuto.montant_reel
      const { data: mission } = await supa.from('mission_menage')
        .select('id').eq('ventilation_auto_id', existingAuto.id).maybeSingle()
      missionToMigrate = mission?.id || null
    }
  }

  // Supprimer + insérer
  const { error: delErr } = await supa.from('ventilation').delete().eq('reservation_id', resa.id)
  if (delErr) throw new Error(`DELETE ventilation: ${delErr.message}`)
  if (lignes.length > 0) {
    const { error } = await supa.from('ventilation').insert(lignes)
    if (error) throw error
  }

  // Restaurer montant_reel + mouvement_id
  const codesToRestore = new Set([...Object.keys(existingReels), ...Object.keys(existingMouvements)])
  if (isProlongation) codesToRestore.delete('AUTO')
  for (const code of codesToRestore) {
    const patch = {}
    if (existingReels[code]      != null) patch.montant_reel = existingReels[code]
    if (existingMouvements[code] != null) patch.mouvement_id = existingMouvements[code]
    if (Object.keys(patch).length > 0)
      await supa.from('ventilation').update(patch).eq('reservation_id', resa.id).eq('code', code)
  }

  await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)

  // Migration prolongation → résa originale
  if (isProlongation && missionToMigrate) {
    let originalResaId = resa.originalResaId || null
    if (!originalResaId) {
      const { data: orig } = await supa.from('reservation').select('id')
        .eq('bien_id', resa.bien_id)
        .eq('departure_date', (resa.arrival_date || '').substring(0, 10))
        .neq('id', resa.id).maybeSingle()
      originalResaId = orig?.id || null
    }
    if (originalResaId) {
      const { data: origAuto } = await supa.from('ventilation').select('id')
        .eq('reservation_id', originalResaId).eq('code', 'AUTO').maybeSingle()
      if (origAuto?.id) {
        await supa.from('mission_menage').update({ ventilation_auto_id: origAuto.id }).eq('id', missionToMigrate)
        if (autoMontantReel != null)
          await supa.from('ventilation').update({ montant_reel: autoMontantReel }).eq('id', origAuto.id)
      }
    }
  }

  // Lier mission_menage → ligne AUTO
  const { data: ligneAuto } = await supa.from('ventilation').select('id')
    .eq('reservation_id', resa.id).eq('code', 'AUTO').single()
  if (ligneAuto?.id) {
    try { await supa.rpc('lier_ventilation_auto_mission', { p_reservation_id: resa.id, p_ventilation_id: ligneAuto.id }) } catch {}
  }
}

// ── Traitement mois complet (port de calculerVentilationMois) ─────────────────

async function processMois(mois, agence, supa) {
  // Verrou factures
  const { data: facturesVerrouillees } = await supa.from('facture_evoliz')
    .select('proprietaire_id').eq('mois', mois).eq('type_facture', 'honoraires')
    .in('statut', STATUTS_VERROU_FACTURE)
  const proprietairesVerrouilles = new Set(
    (facturesVerrouillees || []).map(f => f.proprietaire_id).filter(Boolean)
  )

  // Supprimer ventilations orphelines des resas annulées sans payout
  const { data: resasCancelleesIds } = await supa.from('reservation').select('id')
    .eq('mois_comptable', mois)
    .in('final_status', ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired'])
    .or('fin_revenue.is.null,fin_revenue.eq.0')
  if (resasCancelleesIds?.length) {
    await supa.from('ventilation').delete()
      .in('reservation_id', resasCancelleesIds.map(r => r.id))
  }

  // Charger toutes les réservations du mois
  const { data: reservations, error } = await supa.from('reservation').select(`
    *,
    bien (
      id, proprietaire_id,
      provision_ae_ref, forfait_dcb_ref, has_ae,
      taux_commission_override, gestion_loyer, agence, skip_facturation,
      proprietaire!proprietaire_id (id, taux_commission)
    ),
    reservation_fee (*),
    reservation_ajustement (*)
  `)
    .eq('mois_comptable', mois)
    .or('fin_revenue.gt.0,final_status.not.in.("cancelled","not_accepted","not accepted","declined","expired")')
  if (error) throw error

  // Détection prolongations (critère A)
  const resasByBienGuest = {}
  for (const r of reservations || []) {
    const key = `${r.bien_id}|${(r.guest_name || '').toLowerCase().trim()}`
    if (!resasByBienGuest[key]) resasByBienGuest[key] = []
    resasByBienGuest[key].push(r)
  }
  for (const group of Object.values(resasByBienGuest)) {
    if (group.length < 2) continue
    for (const r of group) {
      const fees = r.reservation_fee || []
      const cleaningFee  = fees.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount  || 0
      const communityFee = fees.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
      const blocksProlongation = cleaningFee > 0 || (r.platform !== 'manual' && communityFee > 0)
      if (blocksProlongation) continue
      const preceding = group.find(
        other => other.id !== r.id
          && (other.departure_date || '').substring(0, 10) === (r.arrival_date || '').substring(0, 10)
      )
      if (preceding) { r.isProlongation = true; r.originalResaId = preceding.id }
    }
  }

  let total = 0, errors = 0, skipped = 0
  const errorDetails = []

  const resasFiltrees = (reservations || [])
    .filter(r => r.bien != null && (r.bien.agence || agence) === agence)

  for (const resa of resasFiltrees) {
    if (proprietairesVerrouilles.has(resa.bien?.proprietaire_id)) { skipped++; continue }
    try {
      await _writeResa(resa, agence, supa)
      total++
    } catch (err) {
      errorDetails.push({ code: resa.code, msg: err.message })
      errors++
    }
  }

  const prolongations = (reservations || [])
    .filter(r => r.isProlongation)
    .map(r => ({
      code: r.code,
      originalResaId: r.originalResaId || null,
      originalResaCode: (reservations || []).find(o => o.id === r.originalResaId)?.code || null,
    }))

  supa.from('journal_ops').insert({
    categorie: 'ventilation', action: 'compute', mois_comptable: mois,
    statut: errors > 0 ? 'warning' : 'ok', source: 'app',
    message: `Ventilation ${mois} : ${total} résa(s) calculée(s)${skipped > 0 ? ', ' + skipped + ' verrouillée(s)' : ''}${errors > 0 ? ', ' + errors + ' erreur(s)' : ''}${prolongations.length > 0 ? ', ' + prolongations.length + ' prolongation(s)' : ''}`,
    meta: { total, skipped, errors, errorDetails, prolongations },
  }).then(null, () => {})

  return { total, skipped, errors, errorDetails, prolongations }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' })

  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })
  if (!SUPABASE_ANON_KEY) return res.status(500).json({ error: 'SUPABASE_ANON_KEY non configuré' })

  // Auth
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Token manquant' })
  if (!(await verifyToken(token))) return res.status(401).json({ error: 'Non authentifié' })

  const { mois, reservation_id, agence = 'dcb' } = req.body || {}
  const supa = createClient(SUPABASE_URL, SUPABASE_SRK)

  try {
    // ── Mode mois complet ──────────────────────────────────────────────────────
    if (mois) {
      const result = await processMois(mois, agence, supa)
      return res.json({ ok: true, ...result })
    }

    // ── Mode réservation individuelle ─────────────────────────────────────────
    if (reservation_id) {
      const { data: resa, error: fetchErr } = await supa.from('reservation').select(`
        *,
        bien (
          id, proprietaire_id,
          provision_ae_ref, forfait_dcb_ref, has_ae,
          taux_commission_override, gestion_loyer, agence,
          proprietaire!proprietaire_id (id, taux_commission)
        ),
        reservation_fee (*),
        reservation_ajustement (*)
      `).eq('id', reservation_id).single()
      if (fetchErr) throw fetchErr
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' })

      await _writeResa(resa, agence, supa)
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: 'Paramètre manquant : mois ou reservation_id requis' })
  } catch (err) {
    console.error('[ventiler]', err)
    return res.status(500).json({ error: err.message })
  }
}
