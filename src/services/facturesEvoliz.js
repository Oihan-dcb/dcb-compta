/**
 * Service de gÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©ration des factures Evoliz DCB ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ PropriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taire
 *
 * Workflow :
 * 1. En dÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©but de mois : gÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer les brouillons pour tous les proprios actifs
 * 2. VÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rification : statements finalisÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©s, montants AE validÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©s (non bloquant)
 * 3. Validation manuelle par Oihan
 * 4. Push vers Evoliz via API
 * 5. Tracking statut paiement
 *
 * Structure facture :
 * - Ligne COM : ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ£ reservation_commissions ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ taux ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ TVA 20%
 * - Ligne MEN : ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ£ (guest_fees - provision AE) + management_fees ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ TVA 20%
 * - Ligne DIV : ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ£ expenses [DCB] ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ TVA 20%
 * - Mention : "ConformÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©ment au mandat de gestion..."
 */

import { supabase } from '../lib/supabase'
import { logOp } from './journal'

const MENTION_MANDAT = "Conformément au mandat de gestion, les honoraires de gestion sont directement prélevés sur le loyer encaissé avant reversement au propriétaire."

/**
 * GÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re les brouillons de factures pour tous les propriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taires actifs d'un mois
 * @param {string} mois - YYYY-MM
 */
export async function genererFacturesMois(mois) {
  const log = { created: 0, updated: 0, skipped: 0, errors: 0, resteAPayer: 0, deboursCreated: 0, deboursUpdated: 0 }

  // RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer tous les propriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taires avec des biens actifs
  const { data: proprietaires, error: propErr } = await supabase
    .from('proprietaire')
    .select(`
      id, nom, prenom, id_evoliz, iban,
      bien!inner (
        id, hospitable_name, code, listed, agence,
        provision_ae_ref, forfait_dcb_ref, has_ae, mode_encaissement, groupe_facturation
      )
    `)
    .eq('bien.listed', true)
    .eq('bien.agence', 'dcb')
    .eq('actif', true)

  if (propErr) throw propErr

  // DÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©dupliquer (un proprio peut avoir plusieurs biens)
  const propMap = new Map()
  for (const p of (proprietaires || [])) {
    if (!propMap.has(p.id)) propMap.set(p.id, { ...p, biens: [] })
    propMap.get(p.id).biens.push(...p.bien)
  }

  const allBienIds      = [...propMap.values()].flatMap(p => p.biens.map(b => b.id))
  const proprietaireIds = [...propMap.keys()]
  const ctx = await prechargerDonneesFacturation(mois, allBienIds, proprietaireIds)

  for (const [propId, proprio] of propMap) {
    // Grouper les biens : groupe_facturation non null → 1 facture par groupe, null → 1 facture par bien
    const groupes = {}
    for (const bien of proprio.biens) {
      const key = bien.groupe_facturation ? `groupe_${bien.groupe_facturation}` : `bien_${bien.id}`
      if (!groupes[key]) groupes[key] = []
      groupes[key].push(bien)
    }
    for (const [key, biens] of Object.entries(groupes)) {
      try {
        const facture = await genererFactureGroupe(proprio, biens, mois, ctx)
        if (facture.skipped) log.skipped++
        else if (facture.created) log.created++
        else log.updated++
        if ((facture.resteAPayer || 0) > 0) log.resteAPayer += facture.resteAPayer

        const debours = await genererFactureDebours(proprio, biens, mois, ctx)
        if (debours && !debours.skipped) {
          if (debours.created) log.deboursCreated++
          else log.deboursUpdated++
        }
      } catch (err) {
        console.error(`Erreur facture ${proprio.nom} [${key}]:`, err)
        log.errors++
      }
    }
  }

  // CF-P1 dcb_direct : récap interne uniquement (pas de facturation propriétaire)
  // allBienIds déjà calculé avant le préchargement
  const { data: dcbDirectItems } = await supabase
    .from('prestation_hors_forfait')
    .select('montant')
    .in('bien_id', allBienIds)
    .eq('mois', mois)
    .eq('statut', 'valide')
    .eq('type_imputation', 'dcb_direct')
  log.dcbDirectTotal = (dcbDirectItems || []).reduce(function(s,p){ return s + (p.montant || 0) }, 0)
  log.dcbDirectCount = (dcbDirectItems || []).length

  logOp({
    categorie: 'facture', action: 'generate', mois_comptable: mois,
    statut: log.errors > 0 ? 'warning' : 'ok', source: 'app',
    message: `Factures ${mois} : ${log.created} créée(s), ${log.updated} mise(s) à jour${log.skipped > 0 ? ', ' + log.skipped + ' ignorée(s) (déjà envoyée(s))' : ''}, ${log.deboursCreated + log.deboursUpdated} débours${log.errors > 0 ? ', ' + log.errors + ' erreur(s)' : ''}`,
    meta: log,
  }).catch(() => {})
  return log
}

/**
 * GÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re ou met ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ  jour la facture mensuelle d'un propriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taire
 */
async function prechargerDonneesFacturation(mois, bienIds, proprietaireIds) {
  const [
    { data: ventilData },
    { data: resaData },
    { data: osResaData },
    { data: prestData },
    { data: fraisData },
    { data: expenseData },
    { data: facturesData },
  ] = await Promise.all([
    supabase.from('ventilation')
      .select('bien_id, code, montant_ht, montant_tva, montant_ttc, montant_reel, reservation_id')
      .in('bien_id', bienIds).eq('mois_comptable', mois),

    supabase.from('reservation')
      .select('id, bien_id, code, platform, fin_revenue, mois_comptable, reservation_fee(fee_type, label, amount, category)')
      .in('bien_id', bienIds).eq('mois_comptable', mois)
      .eq('owner_stay', false).neq('final_status', 'cancelled').gt('fin_revenue', 0),

    supabase.from('reservation')
      .select('id, bien_id')
      .in('bien_id', bienIds).eq('mois_comptable', mois)
      .eq('owner_stay', true).eq('platform', 'manual'),

    supabase.from('prestation_hors_forfait')
      .select('bien_id, montant, type_imputation, description, prestation_type:prestation_type_id(nom), ae:ae_id(type)')
      .in('bien_id', bienIds).eq('mois', mois).eq('statut', 'valide')
      .in('type_imputation', ['deduction_loy', 'haowner', 'debours_proprio']),

    supabase.from('frais_proprietaire')
      .select('id, bien_id, montant_ttc, libelle, mode_traitement, mode_encaissement, statut')
      .in('bien_id', bienIds).eq('mois_facturation', mois)
      .in('mode_traitement', ['deduire_loyer', 'remboursement', 'facturer_direct']),

    supabase.from('expense')
      .select('bien_id, amount, description, type_expense')
      .in('bien_id', bienIds).eq('mois_comptable', mois)
      .eq('type_expense', 'DCB').eq('validee', true),

    supabase.from('facture_evoliz')
      .select('id, statut, proprietaire_id, bien_id, type_facture')
      .in('proprietaire_id', proprietaireIds).eq('mois', mois)
      .in('type_facture', ['honoraires', 'debours']),
  ])

  const facturesExistantes = new Map()
  for (const f of (facturesData || [])) {
    const key = `${f.proprietaire_id}__${f.bien_id ?? 'null'}__${f.type_facture}`
    facturesExistantes.set(key, { id: f.id, statut: f.statut })
  }

  return {
    ventilationGlobale:   ventilData    || [],
    reservationsGlobales: resaData      || [],
    ownerStayGlobal:      osResaData    || [],
    prestationsGlobales:  prestData     || [],
    fraisGlobaux:         fraisData     || [],
    expensesGlobales:     expenseData   || [],
    facturesExistantes,
  }
}

async function genererFactureGroupe(proprio, biens, mois, ctx) {
  const bienIds = biens.map(b => b.id)
  const bienId = biens.length === 1 ? biens[0].id : null
  const libelleGroupe = biens.length === 1
    ? biens[0].hospitable_name
    : (biens[0].groupe_facturation === 'MAITE' ? 'Maison Maïté' : biens.map(b => b.code).join(', '))

  // RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer les rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servations du mois pour ces biens
  const reservations  = ctx.reservationsGlobales.filter(r => bienIds.includes(r.bien_id))
  const expenses       = ctx.expensesGlobales.filter(e => bienIds.includes(e.bien_id))
  const ventilation    = ctx.ventilationGlobale.filter(v => bienIds.includes(v.bien_id))
  const ownerStayResas = ctx.ownerStayGlobal.filter(r => bienIds.includes(r.bien_id))

  const aeParBien = new Map()

  const prestationsDeduction = ctx.prestationsGlobales.filter(p => bienIds.includes(p.bien_id) && p.type_imputation === 'deduction_loy')
  const totalPrestations = (prestationsDeduction || []).reduce((s, p) => {
    const isStaff = p.ae?.type === 'staff'
    return s + (isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0))
  }, 0)

  const prestationsHaowner = ctx.prestationsGlobales.filter(p => bienIds.includes(p.bien_id) && p.type_imputation === 'haowner')
  const haownerHT  = (prestationsHaowner || []).reduce((s, p) => s + (p.montant || 0), 0)
  const haownerTVA = Math.round(haownerHT * 0.20)
  const haownerTTC = haownerHT + haownerTVA

  const prestationsDeboursProprio = ctx.prestationsGlobales.filter(p => bienIds.includes(p.bien_id) && p.type_imputation === 'debours_proprio')

  const fraisDeduire = ctx.fraisGlobaux.filter(f =>
    bienIds.includes(f.bien_id) &&
    f.mode_traitement === 'deduire_loyer' &&
    f.mode_encaissement === 'dcb' &&
    ['a_facturer', 'facture'].includes(f.statut)
  )
  const fraisDeduireTTC = (fraisDeduire || []).reduce((s, f) => s + (f.montant_ttc || 0), 0)

  const remboursements = ctx.fraisGlobaux.filter(f =>
    bienIds.includes(f.bien_id) &&
    f.mode_traitement === 'remboursement' &&
    f.statut !== 'brouillon'
  )
  const remboursementsTotal = (remboursements || []).reduce((s, f) => s + (f.montant_ttc || 0), 0)

  const fraisDirect = ctx.fraisGlobaux.filter(f =>
    bienIds.includes(f.bien_id) &&
    f.mode_traitement === 'facturer_direct' &&
    f.mode_encaissement === 'dcb' &&
    ['a_facturer', 'facture'].includes(f.statut)
  )
  const fraisDirectTTC = (fraisDirect || []).reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const fraisDirectHT  = Math.round(fraisDirectTTC / 1.20)
  const fraisDirectTVA = fraisDirectTTC - fraisDirectHT

  const osResaIds = new Set((ownerStayResas || []).map(r => r.id))

  const osVentByBien = new Map()
  if (osResaIds.size > 0) {
    for (const v of ventilation.filter(l => osResaIds.has(l.reservation_id) && (l.code === 'FMEN' || l.code === 'AUTO'))) {
      if (!osVentByBien.has(v.bien_id)) osVentByBien.set(v.bien_id, { fmenTTC: 0, autoHT: 0 })
      const e = osVentByBien.get(v.bien_id)
      if (v.code === 'FMEN') e.fmenTTC += (v.montant_ttc || 0)
      if (v.code === 'AUTO') e.autoHT += (v.montant_ht || 0)
    }
  }

  const sumByCode = (code) => ventilation
    .filter(l => l.code === code && !(code === 'FMEN' && osResaIds.has(l.reservation_id)))
    .reduce((s, l) => ({
      ht: s.ht + l.montant_ht,
      tva: s.tva + l.montant_tva,
      ttc: s.ttc + l.montant_ttc,
    }), { ht: 0, tva: 0, ttc: 0 })

  const com = sumByCode('HON')
  const men = sumByCode('FMEN')
  const mgt = sumByCode('MGT')
  const ae  = sumByCode('AE')
  const loy = sumByCode('LOY')
  const vir = sumByCode('VIR')

  // DIV : expenses [DCB]
  const divHT = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0)
  const divTVA = Math.round(divHT * 0.20)
  const div = { ht: divHT, tva: divTVA, ttc: divHT + divTVA }

  // MEN consolidÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ© = MEN + MGT
  const menConsolide = {
    ht: men.ht + mgt.ht,
    tva: men.tva + mgt.tva,
    ttc: men.ttc + mgt.ttc,
  }

  // AUTO étape 1 : absorption bien par bien -- mode_encaissement = 'dcb' uniquement
  // fraisDeductionMap : frais.id → { deduit, reliquat } -- calcul frais par frais pour ne pas perdre le reliquat
  const fraisDeductionMap = new Map()
  let autoAbsorbableTotal = 0
  let autoSurplusTotal    = 0
  let deboursPropAbsorbTotal  = 0
  let deboursPropSurplusTotal = 0
  // Owner stay ménage : absorption per-bien du LOY résiduel après deboursProp
  // Surplus FMEN → ligne prestation de service ; surplus AUTO → DEB_AE dans facture débours
  let ownerStayAbsorbTotal = 0
  const ownerStaySurplusByBien = new Map()

  for (const bien of biens) {
    if (bien.mode_encaissement !== 'dcb') continue

    // LOY de ce bien depuis ventilation dÃÂ©jÃÂ  chargÃÂ©e
    const loyBien = ventilation
      .filter(l => l.bien_id === bien.id && l.code === 'LOY')
      .reduce((s, l) => s + l.montant_ht, 0)

    // DÃÂ©ductions deduction_loy de ce bien
    const prestBien = (prestationsDeduction || [])
      .filter(p => p.bien_id === bien.id)
      .reduce((s, p) => {
        const isStaff = p.ae?.type === 'staff'
        return s + (isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0))
      }, 0)

    // HAOWNER TTC de ce bien
    const haownerBienHT  = (prestationsHaowner || [])
      .filter(p => p.bien_id === bien.id)
      .reduce((s, p) => s + (p.montant || 0), 0)
    const haownerBienTTC = haownerBienHT + Math.round(haownerBienHT * 0.20)

    // Frais propriétaire : traités frais par frais pour calculer deduit vs reliquat
    // LOY disponible après prestations et HAOWNER, avant frais
    let loyDispoPrealable = Math.max(0, loyBien - prestBien - haownerBienTTC)
    for (const frais of (fraisDeduire || []).filter(f => f.bien_id === bien.id)) {
      const deduit   = Math.min(frais.montant_ttc, loyDispoPrealable)
      const reliquat = frais.montant_ttc - deduit
      fraisDeductionMap.set(frais.id, { deduit, reliquat })
      loyDispoPrealable = Math.max(0, loyDispoPrealable - deduit)
    }

    // AUTO depuis ventilation deja chargee en memoire
    const autoBien = ventilation
      .filter(function(l) { return l.bien_id === bien.id && l.code === 'AUTO' })
      .reduce(function(s, l) { return s + (l.montant_reel !== null ? l.montant_reel : (l.montant_ht || 0)) }, 0)
    // MEN de ce bien : AUTO est deja deduit du MEN pour donner FMEN
    // La part AUTO couverte par MEN ne touche pas le LOY du proprio (CAS DCB)
    const menBien = ventilation
      .filter(function(l) { return l.bien_id === bien.id && l.code === 'MEN' })
      .reduce(function(s, l) { return s + l.montant_ht }, 0)
    const autoCouvertMen = Math.min(autoBien, menBien)
    const autoNetMen     = Math.max(0, autoBien - autoCouvertMen)

    const loyBienDisponible = loyDispoPrealable
    // Absorption et surplus bien par bien
    // Seul le surplus AUTO au-dela du MEN absorbe du LOY
    const autoAbsorbableBien = Math.min(autoNetMen, loyBienDisponible)
    const autoSurplusBien    = Math.max(0, autoNetMen - autoAbsorbableBien)

    // debours_proprio : absorbe le LOY résiduel après AUTO
    const deboursPropBien = (prestationsDeboursProprio || [])
      .filter(function(p){ return p.bien_id === bien.id })
      .reduce(function(s,p){ return s + (p.montant || 0) }, 0)
    const loyApresAuto       = Math.max(0, loyBienDisponible - autoAbsorbableBien)
    const deboursPropAbsorb  = Math.min(deboursPropBien, loyApresAuto)
    const deboursPropSurplus = Math.max(0, deboursPropBien - deboursPropAbsorb)

    autoAbsorbableTotal += autoAbsorbableBien
    autoSurplusTotal    += autoSurplusBien
    deboursPropAbsorbTotal  += deboursPropAbsorb
    deboursPropSurplusTotal += deboursPropSurplus

    // Owner stay ménage : absorbe le LOY résiduel après deboursProp
    // AUTO absorbé en priorité (hors TVA), puis FMEN (TTC, TVA 20%)
    const loyApresDeboursProp = Math.max(0, loyApresAuto - deboursPropAbsorb)
    const osData = osVentByBien.get(bien.id) || { fmenTTC: 0, autoHT: 0 }
    const osAutoAbsorb   = Math.min(osData.autoHT, loyApresDeboursProp)
    const osAutoSurplus  = Math.max(0, osData.autoHT - osAutoAbsorb)
    const loyApresOsAuto = Math.max(0, loyApresDeboursProp - osAutoAbsorb)
    const osFmenAbsorb   = Math.min(osData.fmenTTC, loyApresOsAuto)
    const osFmenSurplus  = Math.max(0, osData.fmenTTC - osFmenAbsorb)
    ownerStayAbsorbTotal += osAutoAbsorb + osFmenAbsorb
    if (osFmenSurplus > 0 || osAutoSurplus > 0) {
      ownerStaySurplusByBien.set(bien.id, { osFmenSurplus, osAutoSurplus, bienName: bien.hospitable_name })
    }
  }

  // Totaux frais post-boucle : part effectivement déduite du LOY vs reliquat non couvert
  const fraisDeduitTotal   = [...fraisDeductionMap.values()].reduce((s, v) => s + v.deduit,   0)
  const fraisReliquatTotal = [...fraisDeductionMap.values()].reduce((s, v) => s + v.reliquat, 0)

  // Owner stay FMEN surplus → lignes prestation de service TVA 20% incluses dans totalHT/TTC
  let osFmenSurplusGlobalTTC = 0
  for (const [, { osFmenSurplus }] of ownerStaySurplusByBien) osFmenSurplusGlobalTTC += osFmenSurplus
  const osFmenSurplusHT  = Math.round(osFmenSurplusGlobalTTC / 1.20)
  const osFmenSurplusTVA = osFmenSurplusGlobalTTC - osFmenSurplusHT

  // Totaux facture (inclut owner stay FMEN surplus facturé séparément + frais directs)
  const totalHT = com.ht + menConsolide.ht + div.ht + haownerHT + osFmenSurplusHT + fraisDirectHT
  const totalTVA = com.tva + menConsolide.tva + div.tva + haownerTVA + osFmenSurplusTVA + fraisDirectTVA
  const totalTTC = totalHT + totalTVA

  // ownerStayAbsorbTotal = part couverte par LOY → réduit le reversement
  // autoAbsorbableTotal  = AUTO couvert par LOY → réduit le reversement (surplus facturé en DEB_AE séparé)
  // owner stay surplus = facturé séparément → ne réduit pas le reversement
  const montantReversement = Math.max(0, vir.ht - totalPrestations - haownerTTC - fraisDirectTTC - fraisDeduitTotal - deboursPropAbsorbTotal - ownerStayAbsorbTotal - autoAbsorbableTotal) + remboursementsTotal

  // Cas solde nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©gatif : uniquement des expenses, pas de rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servations
  const soldeNegatif = totalHT === 0 && div.ht > 0

  // VÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rifier si facture existante
  const existingFacture = ctx.facturesExistantes.get(
    `${proprio.id}__${bienId ?? 'null'}__honoraires`
  ) ?? null

  // Ne pas ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©craser une facture dÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©jÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ  envoyÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©e ou payÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©e
  if (existingFacture && ['envoye_evoliz', 'payee'].includes(existingFacture.statut)) {
    // Rafraîchir la ligne mémo AUTO même si la facture est déjà envoyée à Evoliz
    const autoTotal = autoAbsorbableTotal + autoSurplusTotal
    await supabase.from('facture_evoliz_ligne').delete()
      .eq('facture_id', existingFacture.id).eq('code', 'AUTO')
    if (autoTotal > 0) {
      await supabase.from('facture_evoliz_ligne').insert({
        facture_id: existingFacture.id,
        code: 'AUTO',
        libelle: 'Prestations AE — mémo',
        description: 'Total coûts AE du mois. Non facturé Evoliz.',
        montant_ht: autoTotal,
        taux_tva: null,
        montant_tva: 0,
        montant_ttc: autoTotal,
        ordre: 99,
      })
    }
    // Supprimer l'ancienne ligne RECAP si elle existe (remplacée par le contrôle virements UI)
    await supabase.from('facture_evoliz_ligne').delete()
      .eq('facture_id', existingFacture.id).eq('code', 'RECAP')
    return { created: false, skipped: true, raison: 'Facture déjà envoyée' }
  }

  const factureData = {
    mois,
    proprietaire_id: proprio.id,
    bien_id: bienId,
    type_facture: 'honoraires',
    total_ht: totalHT,
    total_tva: totalTVA,
    total_ttc: totalTTC,
    montant_reversement: montantReversement,
    statut: totalHT === 0 && div.ht === 0 ? 'calcul_en_cours' : 'brouillon',
    solde_negatif: soldeNegatif,
    montant_reclame: soldeNegatif ? div.ht : null,
  }

  let factureId
  let created = false

  if (existingFacture) {
    await supabase.from('facture_evoliz')
      .update(factureData)
      .eq('id', existingFacture.id)
    factureId = existingFacture.id
  } else {
    const { data: newFacture, error } = await supabase
      .from('facture_evoliz')
      .insert(factureData)
      .select('id')
      .single()
    if (error) throw error
    factureId = newFacture.id
    created = true
  }

  // Supprimer et recrÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©er les lignes
  // Sauvegarder les lignes existantes pour rollback si l'insert échoue (C6)
  const { data: oldLignes } = await supabase
    .from('facture_evoliz_ligne')
    .select('facture_id, code, libelle, description, montant_ht, taux_tva, montant_tva, montant_ttc, ordre')
    .eq('facture_id', factureId)

  await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', factureId)

  const lignes = []
  let ordre = 1

  if (com.ht > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'HON',
      libelle: 'Honoraires de gestion',
      description: `${libelleGroupe} — ${reservations?.length || 0} réservation(s) — ${mois}`,
      montant_ht: com.ht,
      taux_tva: 20,
      montant_tva: com.tva,
      montant_ttc: com.ttc,
      ordre: ordre++,
    })
  }

  if (menConsolide.ht > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'FMEN',
      libelle: 'Forfait ménage, linge et frais de service',
      description: MENTION_MANDAT,
      montant_ht: menConsolide.ht,
      taux_tva: 20,
      montant_tva: menConsolide.tva,
      montant_ttc: menConsolide.ttc,
      ordre: ordre++,
    })
  }

  if (div.ht > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'DIV',
      libelle: soldeNegatif ? 'Frais avancés — remboursement demandé' : 'Frais divers avancés',
      description: (expenses || []).map(e => e.description).join(', ') || 'Frais divers',
      montant_ht: div.ht,
      taux_tva: 20,
      montant_tva: div.tva,
      montant_ttc: div.ttc,
      ordre: ordre++,
    })
  }

  // CF-P1 : une ligne PREST par prestation deduite (TVA 20% si staff, 0% si AE)
  for (const p of (prestationsDeduction || [])) {
    if (!(p.montant > 0)) continue
    const isStaff = p.ae?.type === 'staff'
    const ht  = p.montant
    const tva = isStaff ? Math.round(ht * 0.20) : 0
    const ttc = ht + tva
    lignes.push({
      facture_id:  factureId,
      code:        'PREST',
      libelle:     `Prestation deduite : ${p.description || p.prestation_type?.nom || 'Prestation hors forfait'}`,
      montant_ht:  -ht,
      taux_tva:    isStaff ? 20 : 0,
      montant_tva: -tva,
      montant_ttc: -ttc,
      ordre:       ordre++,
    })
  }

  // CF-P1 HAOWNER : ligne facturable proprietaire (TVA 20%, incluse dans push Evoliz)
  if (haownerHT > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'HAOWNER',
      libelle: prestationsHaowner && prestationsHaowner.length === 1
        ? `Achat avance : ${prestationsHaowner[0].description || prestationsHaowner[0].prestation_type?.nom || 'Frais proprietaire'}`
        : `Achats avances : ${(prestationsHaowner || []).map(p => p.description || p.prestation_type?.nom || 'Frais').join(', ')}`,
      montant_ht: haownerHT,
      taux_tva: 20,
      montant_tva: haownerTVA,
      montant_ttc: haownerTTC,
      ordre: ordre++,
    })
  }

  // Frais déduits du loyer : ligne négative limitée au montant effectivement déduit
  for (const frais of (fraisDeduire || [])) {
    const { deduit = 0 } = fraisDeductionMap.get(frais.id) || {}
    if (deduit <= 0) continue
    const deduitHT  = Math.round(deduit / 1.20)
    const deduitTVA = deduit - deduitHT
    lignes.push({
      facture_id:  factureId,
      code:        'FRAIS',
      libelle:     frais.libelle || 'Frais proprietaire',
      montant_ht:  -deduitHT,
      taux_tva:    20,
      montant_tva: -deduitTVA,
      montant_ttc: -deduit,
      ordre:       ordre++,
    })
  }

  // CF-P1 debours_proprio : lignes DEBP pour la portion absorbée sur LOY
  for (const p of (prestationsDeboursProprio || [])) {
    if (!(p.montant > 0)) continue
    const bienProp = proprio.biens.find(function(b){ return b.id === p.bien_id })
    if (bienProp?.mode_encaissement !== 'dcb') continue
    const isStaff = p.ae?.type === 'staff'
    const ht  = p.montant
    const tva = isStaff ? Math.round(ht * 0.20) : 0
    const ttc = ht + tva
    lignes.push({
      facture_id:  factureId,
      code:        'DEBP',
      libelle:     `Débours proprio : ${p.description || p.prestation_type?.nom || 'Débours propriétaire'}`,
      montant_ht:  -ht,
      taux_tva:    isStaff ? 20 : 0,
      montant_tva: -tva,
      montant_ttc: -ttc,
      ordre:       ordre++,
    })
  }

  // Frais refacturés directement : lignes positives TVA 20% (charge directe proprio)
  for (const frais of (fraisDirect || [])) {
    const ht  = Math.round(frais.montant_ttc / 1.20)
    const tva = frais.montant_ttc - ht
    lignes.push({
      facture_id:  factureId,
      code:        'FRAIS',
      libelle:     frais.libelle || 'Frais refacturé',
      montant_ht:  ht,
      taux_tva:    20,
      montant_tva: tva,
      montant_ttc: frais.montant_ttc,
      ordre:       ordre++,
    })
  }

  // Owner stay FMEN surplus : ligne prestation de service par bien (TVA 20%)
  for (const [, { osFmenSurplus, bienName }] of ownerStaySurplusByBien) {
    if (osFmenSurplus <= 0) continue
    const osHT  = Math.round(osFmenSurplus / 1.20)
    const osTVA = osFmenSurplus - osHT
    lignes.push({
      facture_id:  factureId,
      code:        'FMEN',
      libelle:     `Ménage séjour propriétaire — ${bienName}`,
      description: 'Prestation de service facturée au propriétaire (LOY insuffisant)',
      montant_ht:  osHT,
      taux_tva:    20,
      montant_tva: osTVA,
      montant_ttc: osFmenSurplus,
      ordre:       ordre++,
    })
  }

  // Ligne mémo AUTO : total AE payé ce mois (non envoyé à Evoliz, taux_tva=null)
  const autoTotal = autoAbsorbableTotal + autoSurplusTotal
  if (autoTotal > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'AUTO',
      libelle: 'Prestations AE — mémo',
      description: 'Total coûts AE du mois. Non facturé Evoliz.',
      montant_ht: autoTotal,
      taux_tva: null,
      montant_tva: 0,
      montant_ttc: autoTotal,
      ordre: 99,
    })
  }


  if (lignes.length > 0) {
    const { error: insertErr } = await supabase.from('facture_evoliz_ligne').insert(lignes)
    if (insertErr) {
      // Rollback best-effort : restaurer les anciennes lignes avant de remonter l'erreur
      if (oldLignes && oldLignes.length > 0) {
        await supabase.from('facture_evoliz_ligne').insert(oldLignes).catch(() => {})
      }
      throw new Error(`Échec insertion lignes facture : ${insertErr.message}`)
    }
  }

  // Mettre à jour chaque frais deduire_loyer : deduit, reliquat, statut_deduction
  for (const frais of (fraisDeduire || [])) {
    const { deduit = 0, reliquat = frais.montant_ttc } = fraisDeductionMap.get(frais.id) || {}
    const statutDeduction = reliquat === 0 ? 'totalement_deduit'
      : deduit === 0 ? 'non_deduit'
      : 'partiellement_deduit'
    await supabase.from('frais_proprietaire')
      .update({
        statut:            'facture',
        montant_deduit_loy: deduit,
        montant_reliquat:   reliquat,
        statut_deduction:   statutDeduction,
      })
      .eq('id', frais.id)
  }

  // Marquer les frais facturer_direct comme facturés (pas de déduction LOY)
  for (const frais of (fraisDirect || [])) {
    await supabase.from('frais_proprietaire')
      .update({
        statut:             'facture',
        montant_deduit_loy: 0,
        montant_reliquat:   frais.montant_ttc,
        statut_deduction:   'non_deduit',
      })
      .eq('id', frais.id)
  }

  const resteAPayer = Math.max(0, (totalPrestations + haownerTTC) - loy.ht) + autoSurplusTotal + deboursPropSurplusTotal + fraisReliquatTotal
  return { created, factureId, totalHT, totalTTC, soldeNegatif, resteAPayer }
}

/**
 * RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re toutes les factures d'un mois avec les dÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©tails
 */
async function genererFactureDebours(proprio, biens, mois, ctx) {
  const lignes = []
  let ordre = 1

  const bienIds = biens.map(function(b) { return b.id })
  const bienId = biens.length === 1 ? biens[0].id : null

  // Données lues depuis le contexte préchargé (pas de requêtes Supabase ici)
  const ventilAuto = ctx.ventilationGlobale.filter(
    v => bienIds.includes(v.bien_id) && (v.code === 'AUTO' || v.code === 'LOY')
  )

  const osResasDebours = ctx.ownerStayGlobal.filter(r => bienIds.includes(r.bien_id))
  const osAutoByBien = new Map()
  if ((osResasDebours || []).length > 0) {
    const osIdsSet = new Set(osResasDebours.map(function(r) { return r.id }))
    const osAutoVent = ctx.ventilationGlobale.filter(
      v => osIdsSet.has(v.reservation_id) && v.code === 'AUTO'
    )
    ;(osAutoVent || []).forEach(function(v) {
      osAutoByBien.set(v.bien_id, (osAutoByBien.get(v.bien_id) || 0) + (v.montant_ht || 0))
    })
  }

  const prestationsAll = ctx.prestationsGlobales.filter(function(p) {
    return bienIds.includes(p.bien_id) &&
      ['deduction_loy', 'haowner', 'debours_proprio'].includes(p.type_imputation)
  })

  // fraisDirectsAll : query DB maintenue intentionnellement (dépendance d'ordre avec genererFactureGroupe)
  const { data: fraisDirectsAll } = await supabase
    .from('frais_proprietaire')
    .select('bien_id, id, montant_ttc, libelle')
    .in('bien_id', bienIds)
    .eq('mois_facturation', mois)
    .eq('mode_traitement', 'facturer_direct')
    .eq('mode_encaissement', 'dcb')
    .eq('statut', 'a_facturer')

  const ventilByBien = new Map()
  const prestByBien  = new Map()
  ;(ventilAuto || []).forEach(function(l) {
    if (!ventilByBien.has(l.bien_id)) ventilByBien.set(l.bien_id, [])
    ventilByBien.get(l.bien_id).push(l)
  })
  ;(prestationsAll || []).forEach(function(p) {
    if (!prestByBien.has(p.bien_id)) prestByBien.set(p.bien_id, [])
    prestByBien.get(p.bien_id).push(p)
  })

  const fraisDirectsByBien = new Map()
  ;(fraisDirectsAll || []).forEach(function(f) {
    if (!fraisDirectsByBien.has(f.bien_id)) fraisDirectsByBien.set(f.bien_id, [])
    fraisDirectsByBien.get(f.bien_id).push(f)
  })

  for (const bien of biens) {
    const bienVentil = ventilByBien.get(bien.id) || []
    const autoBien = bienVentil
      .filter(function(l) { return l.code === 'AUTO' })
      .reduce(function(s, l) { return s + (l.montant_reel !== null ? l.montant_reel : (l.montant_ht || 0)) }, 0)
    // MEN de ce bien : AUTO couvert par MEN ne genere pas de DEB_AE (CAS DCB)
    const menBienDeb = bienVentil
      .filter(function(l) { return l.code === 'MEN' })
      .reduce(function(s, l) { return s + l.montant_ht }, 0)
    const autoNetMenDeb = Math.max(0, autoBien - menBienDeb)

    const osAutoHT = osAutoByBien.get(bien.id) || 0

    if (autoBien === 0 && osAutoHT === 0) continue

    let montantAFacturer = 0
    let debPropSurplus   = 0
    let debPropItems     = []
    let osAutoSurplus    = 0

    if (bien.mode_encaissement === 'proprio') {
      montantAFacturer = autoBien + osAutoHT
    } else {
      const loyBien = bienVentil
        .filter(function(l) { return l.code === 'LOY' })
        .reduce(function(s, l) { return s + l.montant_ht }, 0)

      const bienPrest     = prestByBien.get(bien.id) || []
      const prestBien     = bienPrest
        .filter(function(p) { return p.type_imputation === 'deduction_loy' })
        .reduce(function(s, p) { return s + (p.montant || 0) }, 0)
      const haownerBienHT = bienPrest
        .filter(function(p) { return p.type_imputation === 'haowner' })
        .reduce(function(s, p) { return s + (p.montant || 0) }, 0)
      const haownerBienTTC = haownerBienHT + Math.round(haownerBienHT * 0.20)
      const loyBienDisponible = Math.max(0, loyBien - prestBien - haownerBienTTC)
      const autoAbsorbable    = Math.min(autoNetMenDeb, loyBienDisponible)
      montantAFacturer        = Math.max(0, autoNetMenDeb - autoAbsorbable)

      // debours_proprio : absorbe le LOY résiduel après AUTO
      debPropItems = bienPrest.filter(function(p){ return p.type_imputation === 'debours_proprio' })
      const deboursPropBien = debPropItems.reduce(function(s,p){ return s + (p.montant || 0) }, 0)
      const loyApresAuto    = Math.max(0, loyBienDisponible - autoAbsorbable)
      const debPropAbsorb   = Math.min(deboursPropBien, loyApresAuto)
      debPropSurplus        = Math.max(0, deboursPropBien - debPropAbsorb)
      montantAFacturer     += debPropSurplus

      // Owner stay AUTO : absorbe le LOY résiduel après deboursProp
      const loyApresAll = Math.max(0, loyApresAuto - debPropAbsorb)
      const osAutoAbsorb = Math.min(osAutoHT, loyApresAll)
      osAutoSurplus = Math.max(0, osAutoHT - osAutoAbsorb)
      montantAFacturer += osAutoSurplus
    }

    if (montantAFacturer === 0) continue

    const autoSurplusBienDebours = Math.max(0, montantAFacturer - debPropSurplus - osAutoSurplus)
    if (autoSurplusBienDebours > 0) {
      lignes.push({
        code:        'DEB_AE',
        libelle:     'Debours AE - ' + bien.hospitable_name,
        montant_ht:  autoSurplusBienDebours,
        taux_tva:    0,
        montant_tva: 0,
        montant_ttc: autoSurplusBienDebours,
        ordre:       ordre++,
      })
    }

    // Owner stay AUTO surplus : DEB_AE séparé (débours AE pour séjour propriétaire)
    if (osAutoSurplus > 0) {
      lignes.push({
        code:        'DEB_AE',
        libelle:     'Debours AE séjour propriétaire - ' + bien.hospitable_name,
        montant_ht:  osAutoSurplus,
        taux_tva:    0,
        montant_tva: 0,
        montant_ttc: osAutoSurplus,
        ordre:       ordre++,
      })
    }

    // CF-P1 debours_proprio : ligne DEBP pour le surplus non absorbé par LOY
    if (debPropSurplus > 0) {
      const allStaff = debPropItems.every(function(p){ return p.ae?.type === 'staff' })
      const taux     = allStaff ? 20 : 0
      const tva      = Math.round(debPropSurplus * taux / 100)
      lignes.push({
        code:        'DEBP',
        libelle:     'Débours proprio - ' + bien.hospitable_name,
        montant_ht:  debPropSurplus,
        taux_tva:    taux,
        montant_tva: tva,
        montant_ttc: debPropSurplus + tva,
        ordre:       ordre++,
      })
    }

    // Frais proprietaire a facturer directement -- lignes separees, hors montantAFacturer
    const fraisDirectsBien = fraisDirectsByBien.get(bien.id) || []
    for (const frais of fraisDirectsBien) {
      lignes.push({
        code:        'FRAIS',
        libelle:     frais.libelle,
        montant_ht:  frais.montant_ttc,
        taux_tva:    0,
        montant_tva: 0,
        montant_ttc: frais.montant_ttc,
        ordre:       ordre++,
      })
    }
  }

  const existing = ctx.facturesExistantes.get(
    `${proprio.id}__${bienId ?? 'null'}__debours`
  ) ?? null

  if (lignes.length === 0) {
    // Plus rien à facturer : supprimer le brouillon s'il existe, sinon rien
    if (existing && existing.statut === 'brouillon') {
      await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', existing.id)
      await supabase.from('facture_evoliz').delete().eq('id', existing.id)
      return { created: false, deleted: true }
    }
    return null
  }

  if (existing && ['envoye_evoliz', 'payee'].includes(existing.statut)) {
    return { created: false, skipped: true }
  }

  const totalHT = lignes.reduce((s, l) => s + l.montant_ht, 0)

  const factureData = {
    proprietaire_id:     proprio.id,
    mois,
    bien_id:             bienId,
    type_facture:        'debours',
    total_ht:            totalHT,
    total_tva:           0,
    total_ttc:           totalHT,
    montant_reversement: null,
    solde_negatif:       false,
    statut:              'brouillon',
  }

  let factureId
  let created = false

  if (existing) {
    await supabase.from('facture_evoliz').update(factureData).eq('id', existing.id)
    factureId = existing.id
  } else {
    const { data: newFacture } = await supabase
      .from('facture_evoliz').insert(factureData).select('id').single()
    if (!newFacture?.id) {
      throw new Error(
        'genererFactureDebours: INSERT facture_evoliz n\'a pas retourne d\'id' +
        ` — proprio=${proprio.id} mois=${mois} totalHT=${totalHT}`
      )
    }
    factureId = newFacture?.id
    created = true
  }

  if (factureId) {
    await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', factureId)
    await supabase.from('facture_evoliz_ligne').insert(
      lignes.map(l => ({ ...l, facture_id: factureId }))
    )
    // Passer les frais directs en statut 'facture' -- uniquement dans le chemin non-skipped
    const fraisDirectsIds = (fraisDirectsAll || []).map(f => f.id)
    if (fraisDirectsIds.length > 0) {
      await supabase.from('frais_proprietaire')
        .update({ statut: 'facture' })
        .in('id', fraisDirectsIds)
    }
  }

  return { created, factureId, totalHT, totalTTC: totalHT }
}

export async function getFacturesMois(mois) {
  const { data, error } = await supabase
    .from('facture_evoliz')
    .select(`
      *,
      bien (id, code),
      proprietaire (id, nom, prenom, email, iban, id_evoliz, bien(id, code, groupe_facturation)),
      facture_evoliz_ligne (*)
    `)
    .eq('mois', mois)
    .neq('type_facture', 'com')
    .order('created_at')

  if (error) throw error
  return data || []
}

/**
 * Valide une facture (passage brouillon ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ validÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©)
 */
export async function validerFacture(factureId) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'valide' })
    .eq('id', factureId)
    .eq('statut', 'brouillon')

  if (error) throw error
}

/**
 * Marque une facture comme envoyÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©e dans Evoliz
 * @param {string} factureId
 * @param {string} idEvoliz - ID attribuÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ© par Evoliz
 * @param {string} numeroFacture
 */
export async function marquerEnvoyeeEvoliz(factureId, idEvoliz, numeroFacture) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({
      statut: 'envoye_evoliz',
      id_evoliz: idEvoliz,
      numero_facture: numeroFacture,
      date_emission: new Date().toISOString().substring(0, 10),
    })
    .eq('id', factureId)

  if (error) throw error
}

// ── FACTURE COM (Commissions Web Directes) ───────────────────────────────────

export async function getFactureCOM(mois) {
  const { data } = await supabase
    .from('facture_evoliz')
    .select('id, statut, total_ht, total_ttc, id_evoliz, numero_facture')
    .eq('mois', mois)
    .eq('type_facture', 'com')
    .maybeSingle()
  return data
}

export async function genererFactureCOM(mois) {
  const { data: comLines, error } = await supabase
    .from('ventilation')
    .select('montant_ht, montant_tva, montant_ttc')
    .eq('mois_comptable', mois)
    .eq('code', 'COM')

  if (error) throw error

  const totals = (comLines || []).reduce((acc, l) => ({
    ht:  acc.ht  + (l.montant_ht  || 0),
    tva: acc.tva + (l.montant_tva || 0),
    ttc: acc.ttc + (l.montant_ttc || 0),
  }), { ht: 0, tva: 0, ttc: 0 })

  if (totals.ttc === 0) throw new Error('Aucune commission directe (COM) ce mois — vérifier la ventilation.')

  const { data: existing } = await supabase
    .from('facture_evoliz')
    .select('id, statut')
    .eq('mois', mois)
    .eq('type_facture', 'com')
    .maybeSingle()

  if (existing?.statut === 'envoye_evoliz')
    throw new Error('Facture COM déjà envoyée dans Evoliz — non modifiable.')

  const factureData = {
    mois,
    type_facture: 'com',
    proprietaire_id: null,
    statut: 'brouillon',
    total_ht:  totals.ht,
    total_tva: totals.tva,
    total_ttc: totals.ttc,
    montant_reversement: 0,
  }

  let factureId
  if (existing?.id) {
    const { error: upd } = await supabase.from('facture_evoliz').update(factureData).eq('id', existing.id)
    if (upd) throw upd
    factureId = existing.id
  } else {
    const { data: newF, error: ins } = await supabase.from('facture_evoliz').insert(factureData).select('id').single()
    if (ins) throw ins
    factureId = newF.id
  }

  return { factureId, created: !existing?.id, ...totals }
}

export async function validerFactureCOM(factureId) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'valide' })
    .eq('id', factureId)
    .eq('statut', 'brouillon')
  if (error) throw error
}

/**
 * GÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re l'export CSV pour l'expert-comptable
 * Une ligne par code ventilation par rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servation
 */
export async function exportCSVComptable(mois) {
  const { data: ventilation, error } = await supabase
    .from('ventilation')
    .select(`
      code, libelle, montant_ht, taux_tva, montant_tva, montant_ttc, mois_comptable,
      reservation (code, platform, arrival_date, departure_date),
      bien!inner (hospitable_name, code, agence),
      proprietaire (nom)
    `)
    .eq('mois_comptable', mois)
    .eq('bien.agence', 'dcb')
    .order('code')

  if (error) throw error

  const lignes = [
    // En-tÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂªte
    ['Mois', 'Code comptable', 'Libellé', 'Bien', 'Propriétaire', 'Plateforme',
     'Référence résa', 'Check-in', 'Check-out', 'HT (€)', 'TVA %', 'TVA (€)', 'TTC (€)'],
    // DonnÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©es
    ...(ventilation || []).map(l => [
      l.mois_comptable,
      l.code,
      l.libelle,
      l.bien?.code || l.bien?.hospitable_name || '',
      l.proprietaire?.nom || '',
      l.reservation?.platform || '',
      l.reservation?.code || '',
      l.reservation?.arrival_date || '',
      l.reservation?.departure_date || '',
      (l.montant_ht / 100).toFixed(2),
      l.taux_tva,
      (l.montant_tva / 100).toFixed(2),
      (l.montant_ttc / 100).toFixed(2),
    ])
  ]

  // Convertir en CSV
  const csv = lignes
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n')

  // Ajouter BOM UTF-8 pour Excel
  return '\uFEFF' + csv
}

/**
 * TÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©lÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©charge le CSV dans le navigateur
 */
export function telechargerCSV(contenu, nomFichier) {
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Stats factures Evoliz d'un mois
 */
export async function getStatsFactures(mois) {
  const { data: factures } = await supabase
    .from('facture_evoliz')
    .select('statut, total_ttc, solde_negatif')
    .eq('mois', mois)

  const all = factures || []
  return {
    total: all.length,
    brouillons: all.filter(f => f.statut === 'brouillon').length,
    valides: all.filter(f => f.statut === 'valide').length,
    envoyes: all.filter(f => f.statut === 'envoye_evoliz').length,
    payes: all.filter(f => f.statut === 'payee').length,
    soldes_negatifs: all.filter(f => f.solde_negatif).length,
    total_ttc: all.reduce((s, f) => s + (f.total_ttc || 0), 0),
  }
}
