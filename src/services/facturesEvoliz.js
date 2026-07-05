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
import { AGENCE, AGENCE_BRAND } from '../lib/agence'
import { logOp } from './journal'
import { evolizCall } from './evoliz'

const MENTION_MANDAT = "Conformément au mandat de gestion, les honoraires de gestion sont directement prélevés sur le loyer encaissé avant reversement au propriétaire."

// Cache config de facturation par agence (IBAN séquestre, SIRET, adresse — lus depuis agency_config)
let _agencyBillingConfig = null
async function getAgencyBillingConfig() {
  if (_agencyBillingConfig) return _agencyBillingConfig
  const { data } = await supabase
    .from('agency_config')
    .select('seq_lc_iban, seq_lc_bic, siret, adresse_ligne1, adresse_ligne2')
    .eq('agence', AGENCE)
    .single()
  _agencyBillingConfig = {
    iban: data?.seq_lc_iban || '',
    bic:  data?.seq_lc_bic  || '',
    siret: data?.siret || '',
    adresse: [data?.adresse_ligne1, data?.adresse_ligne2].filter(Boolean).join(', ').trim(),
  }
  return _agencyBillingConfig
}

/**
 * GÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re les brouillons de factures pour tous les propriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taires actifs d'un mois
 * @param {string} mois - YYYY-MM
 */
export async function genererFacturesMois(mois) {
  const log = { created: 0, updated: 0, skipped: 0, errors: 0, resteAPayer: 0, deboursCreated: 0, deboursUpdated: 0, lauianFmenCreated: 0, lauianFmenUpdated: 0, bloquesAjustements: [], aReporter: [] }

  // RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer tous les propriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taires avec des biens actifs
  const { data: proprietaires, error: propErr } = await supabase
    .from('proprietaire')
    .select(`
      id, nom, prenom, id_evoliz, iban,
      bien!proprietaire_id (
        id, hospitable_name, code, listed, agence,
        provision_ae_ref, forfait_dcb_ref, has_ae, mode_encaissement, groupe_facturation, skip_facturation
      )
    `)
    .eq('bien.listed', true)
    .eq('bien.agence', AGENCE)
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
        if (facture.skipped) {
          log.skipped++
          if (facture.ajustementsBloquants?.length) {
            log.bloquesAjustements.push({ proprio: proprio.nom, biens: biens.map(b => b.code), raison: facture.raison })
          }
        }
        else if (facture.created) log.created++
        else log.updated++
        if ((facture.resteAPayer || 0) > 0) log.resteAPayer += facture.resteAPayer
        if (facture.aReporter) log.aReporter.push({ proprio: proprio.nom, biens: biens.map(b => b.code), totalHT: facture.totalHT })

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

  // ── Factures FMEN Lauian (DCB uniquement) ──────────────────────────────────
  // DCB gère le ménage pour tous les biens Lauian — facturé séparément aux proprios Lauian
  if (AGENCE === 'dcb') {
    const { data: proprietairesLauian } = await supabase
      .from('proprietaire')
      .select(`id, nom, prenom, id_evoliz, iban, bien!proprietaire_id(id, hospitable_name, code, listed, agence, provision_ae_ref, forfait_dcb_ref, has_ae, mode_encaissement, groupe_facturation, skip_facturation)`)
      .eq('bien.listed', true)
      .eq('bien.agence', 'lauian')
      .eq('actif', true)

    if (proprietairesLauian?.length) {
      const lauianPropMap = new Map()
      for (const p of proprietairesLauian) {
        if (!lauianPropMap.has(p.id)) lauianPropMap.set(p.id, { ...p, biens: [] })
        lauianPropMap.get(p.id).biens.push(...p.bien)
      }
      const lauianBienIds = [...lauianPropMap.values()].flatMap(p => p.biens.map(b => b.id))
      const lauianPropIds = [...lauianPropMap.keys()]
      const ctxLauian = await prechargerDonneesFacturation(mois, lauianBienIds, lauianPropIds, 'dcb')

      for (const [, proprio] of lauianPropMap) {
        const groupes = {}
        for (const bien of proprio.biens) {
          const key = bien.groupe_facturation ? `groupe_${bien.groupe_facturation}` : `bien_${bien.id}`
          if (!groupes[key]) groupes[key] = []
          groupes[key].push(bien)
        }
        for (const [key, biens] of Object.entries(groupes)) {
          try {
            const fmen = await genererFactureLauianFMEN(proprio, biens, mois, ctxLauian)
            if (fmen && !fmen.skipped) {
              if (fmen.created) log.lauianFmenCreated++
              else log.lauianFmenUpdated++
            }
          } catch (err) {
            console.error(`Erreur FMEN Lauian ${proprio.nom} [${key}]:`, err)
            log.errors++
          }
        }
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
    message: `Factures ${mois} : ${log.created} créée(s), ${log.updated} mise(s) à jour${log.skipped > 0 ? ', ' + log.skipped + ' ignorée(s) (déjà envoyée(s))' : ''}, ${log.deboursCreated + log.deboursUpdated} débours${log.lauianFmenCreated + log.lauianFmenUpdated > 0 ? ', ' + (log.lauianFmenCreated + log.lauianFmenUpdated) + ' FMEN Lauian' : ''}${log.errors > 0 ? ', ' + log.errors + ' erreur(s)' : ''}`,
    meta: log,
  }).catch(() => {})
  return log
}

/**
 * GÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re ou met ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ  jour la facture mensuelle d'un propriÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©taire
 */
async function prechargerDonneesFacturation(mois, bienIds, proprietaireIds, agenceFactures = AGENCE) {
  const [
    { data: ventilData },
    { data: resaData },
    { data: osResaData },
    { data: prestData },
    { data: fraisData },
    { data: expenseData },
    { data: facturesData },
    { data: ajustementsData },
  ] = await Promise.all([
    supabase.from('ventilation')
      .select('id, bien_id, code, montant_ht, montant_tva, montant_ttc, montant_reel, fmen_facture, reservation_id')
      .in('bien_id', bienIds).eq('mois_comptable', mois),

    supabase.from('reservation')
      .select('id, bien_id, code, platform, fin_revenue, mois_comptable, reservation_fee(fee_type, label, amount, category)')
      .in('bien_id', bienIds).eq('mois_comptable', mois)
      .eq('owner_stay', false).neq('final_status', 'cancelled').gt('fin_revenue', 0),

    supabase.from('reservation')
      .select('id, bien_id, fin_revenue')
      .in('bien_id', bienIds).eq('mois_comptable', mois)
      .eq('owner_stay', true).eq('platform', 'manual'),

    supabase.from('prestation_hors_forfait')
      .select('bien_id, montant, regime, type_imputation, description, prestation_type:prestation_type_id(nom), ae:ae_id(type)')
      .in('bien_id', bienIds).eq('mois', mois).eq('statut', 'valide')
      .in('type_imputation', ['deduction_loy', 'haowner', 'debours_proprio']),

    supabase.from('frais_proprietaire')
      .select('id, bien_id, montant_ttc, libelle, mode_traitement, mode_encaissement, statut')
      .in('bien_id', bienIds).eq('mois_facturation', mois)
      .in('mode_traitement', ['deduire_loyer', 'remboursement', 'facturer_direct', 'facturer_et_deduire']),

    supabase.from('expense')
      .select('bien_id, amount, description, type_expense')
      .in('bien_id', bienIds).eq('mois_comptable', mois)
      .eq('type_expense', 'DCB').eq('validee', true),

    supabase.from('facture_evoliz')
      .select('id, statut, proprietaire_id, bien_id, type_facture')
      .in('proprietaire_id', proprietaireIds).eq('mois', mois).eq('agence', agenceFactures)
      .in('type_facture', ['honoraires', 'debours', 'lauian_fmen']),

    // Ajustements réservation non qualifiés — bloquent la facturation (voir migration 222-224)
    supabase.from('reservation_ajustement')
      .select('reservation_id, montant, label, reservation:reservation_id(bien_id, code)')
      .eq('mois_comptable', mois).eq('statut', 'a_qualifier'),
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
    ajustementsAQualifier: (ajustementsData || []).map(a => ({
      reservation_id: a.reservation_id,
      bien_id: a.reservation?.bien_id,
      code: a.reservation?.code,
      montant: a.montant,
      label: a.label,
    })).filter(a => a.bien_id),
  }
}

async function genererFactureGroupe(proprio, biens, mois, ctx) {
  const bienIds = biens.map(b => b.id)
  const bienId = biens.length === 1 ? biens[0].id : null
  const libelleGroupe = biens.length === 1
    ? biens[0].hospitable_name
    : (biens[0].groupe_facturation === 'MAITE' ? 'Maison Maïté' : biens.map(b => b.code).join(', '))

  // Bloquant : au moins un ajustement réservation non qualifié sur ces biens ce mois-ci
  // (voir migration 222-224) — les montants HON/FMEN ne sont pas fiables tant qu'il n'est
  // pas traité (Hébergement / Ménage / Sans impact).
  const ajustementsBloquants = ctx.ajustementsAQualifier.filter(a => bienIds.includes(a.bien_id))
  if (ajustementsBloquants.length > 0) {
    return {
      created: false, skipped: true,
      raison: `${ajustementsBloquants.length} ajustement(s) réservation non qualifié(s) (${ajustementsBloquants.map(a => a.code).join(', ')})`,
      ajustementsBloquants,
    }
  }

  // RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer les rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servations du mois pour ces biens
  const reservations  = ctx.reservationsGlobales.filter(r => bienIds.includes(r.bien_id))
  const expenses       = ctx.expensesGlobales.filter(e => bienIds.includes(e.bien_id))
  const ventilation    = ctx.ventilationGlobale.filter(v => bienIds.includes(v.bien_id))
  const ownerStayResas = ctx.ownerStayGlobal.filter(r => bienIds.includes(r.bien_id))

  const aeParBien = new Map()

  const prestationsDeduction = ctx.prestationsGlobales.filter(p => p.regime !== 'sap' && bienIds.includes(p.bien_id) && p.type_imputation === 'deduction_loy')
  const totalPrestations = (prestationsDeduction || []).reduce((s, p) => {
    const isStaff = p.ae?.type === 'staff'
    return s + (isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0))
  }, 0)

  const prestationsHaowner = ctx.prestationsGlobales.filter(p => bienIds.includes(p.bien_id) && p.type_imputation === 'haowner')
  const haownerHT  = (prestationsHaowner || []).reduce((s, p) => s + (p.montant || 0), 0)
  const haownerTVA = Math.round(haownerHT * 0.20)
  const haownerTTC = haownerHT + haownerTVA

  const prestationsDeboursProprio = ctx.prestationsGlobales.filter(p => p.regime !== 'sap' && bienIds.includes(p.bien_id) && p.type_imputation === 'debours_proprio')

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
    ['facturer_direct', 'facturer_et_deduire'].includes(f.mode_traitement) &&
    f.mode_encaissement === 'dcb' &&
    ['a_facturer', 'facture'].includes(f.statut)
  )
  // En mode Lauian : les frais DCB sont facturés par DCB via lauian_fmen — exclus des lignes de cette facture.
  // Mais facturer_et_deduire réduit quand même le reversement Lauian (déduction LOY).
  // facturer_direct DCB ne réduit pas le reversement (facture DCB séparée, sans déduction LOY).
  const fraisDirectPourFacture = AGENCE === 'lauian' ? [] : fraisDirect
  const fraisDirectTTC = (fraisDirect || []).reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const fraisDirectTTCFacture = (fraisDirectPourFacture).reduce((s, f) => s + (f.montant_ttc || 0), 0)
  const fraisDirectHTFacture  = Math.round(fraisDirectTTCFacture / 1.20)
  const fraisDirectTVAFacture = fraisDirectTTCFacture - fraisDirectHTFacture
  // Pour le reversement Lauian : uniquement facturer_et_deduire (déduction LOY)
  const fraisDirectTTCReversement = AGENCE === 'lauian'
    ? fraisDirect.filter(f => f.mode_traitement === 'facturer_et_deduire').reduce((s, f) => s + (f.montant_ttc || 0), 0)
    : fraisDirectTTC
  const fraisDirectHT  = Math.round(fraisDirectTTC / 1.20)
  const fraisDirectTVA = fraisDirectTTC - fraisDirectHT

  // Proprio encaisse : Airbnb/Booking pour biens mode_encaissement='proprio' — DCB n'encaisse pas
  const PLATFORMS_DCB_FACT = ['direct', 'manual']
  const resaPlatMapFact = new Map(reservations.map(r => [r.id, r.platform || '']))
  const isProprioEncaisseVent = (v) => {
    const b = biens.find(bb => bb.id === v.bien_id)
    return b?.mode_encaissement === 'proprio' &&
      !PLATFORMS_DCB_FACT.includes(resaPlatMapFact.get(v.reservation_id) || '')
  }

  // Owner stays absorbés sur le LOY : fin_revenue > 0 OU ménage saisi manuellement
  // (ligne MEN posée depuis PageRapports — le proprio paie même si fin_revenue est null).
  const osAllIds = new Set((ownerStayResas || []).map(r => r.id))
  const osMenSaisiIds = new Set(ventilation.filter(l => l.code === 'MEN' && osAllIds.has(l.reservation_id)).map(l => l.reservation_id))
  const osResaIds = new Set((ownerStayResas || []).filter(r => (r.fin_revenue || 0) > 0 || osMenSaisiIds.has(r.id)).map(r => r.id))

  const osVentByBien = new Map()
  if (osResaIds.size > 0) {
    for (const v of ventilation.filter(l => osResaIds.has(l.reservation_id) && (l.code === 'FMEN' || l.code === 'AUTO' || l.code === 'MEN'))) {
      if (!osVentByBien.has(v.bien_id)) osVentByBien.set(v.bien_id, { fmenTTC: 0, autoHT: 0 })
      const e = osVentByBien.get(v.bien_id)
      if (v.code === 'FMEN') e.fmenTTC += (v.montant_ttc || 0)
      if (v.code === 'AUTO') e.autoHT += (v.montant_ht || 0)
      // MEN saisi manuellement = coût AE refacturé au proprio, hors TVA → canal AUTO (débours),
      // jamais canal FMEN (qui part en prestation TVA 20% sur la facture en cas de surplus)
      if (v.code === 'MEN')  e.autoHT += (v.montant_ht || 0)
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
  // VIR : exclure les resas proprio_encaisse (Airbnb/Booking pour biens proprio — non encaissé par DCB)
  const vir = ventilation
    .filter(l => l.code === 'VIR' && !isProprioEncaisseVent(l))
    .reduce((s, l) => ({ ht: s.ht + l.montant_ht, tva: s.tva + l.montant_tva, ttc: s.ttc + l.montant_ttc }), { ht: 0, tva: 0, ttc: 0 })
  const virProprioEncaisse = ventilation
    .filter(l => l.code === 'VIR' && isProprioEncaisseVent(l))
    .reduce((s, l) => s + l.montant_ht, 0)

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
    // LOY de ce bien depuis ventilation
    const loyBien = ventilation
      .filter(l => l.bien_id === bien.id && l.code === 'LOY')
      .reduce((s, l) => s + l.montant_ht, 0)

    // Pour les biens proprio : seul le LOY des resas direct/manual est encaisse par DCB
    const loyAbsorbable = bien.mode_encaissement === 'proprio'
      ? ventilation
          .filter(l => l.bien_id === bien.id && l.code === 'LOY' &&
            PLATFORMS_DCB_FACT.includes(resaPlatMapFact.get(l.reservation_id) || ''))
          .reduce((s, l) => s + l.montant_ht, 0)
      : loyBien

    // Deductions deduction_loy de ce bien
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

    // Frais proprietaire : traites frais par frais pour calculer deduit vs reliquat
    // DCB : LOY disponible apres prestations et HAOWNER
    // Proprio : seulement le LOY direct/manual, pas de deduction prestBien/haowner
    let loyDispoPrealable = bien.mode_encaissement === 'proprio'
      ? loyAbsorbable
      : Math.max(0, loyBien - prestBien - haownerBienTTC)
    for (const frais of (fraisDeduire || []).filter(f => f.bien_id === bien.id)) {
      const deduit   = Math.min(frais.montant_ttc, loyDispoPrealable)
      const reliquat = frais.montant_ttc - deduit
      fraisDeductionMap.set(frais.id, { deduit, reliquat })
      loyDispoPrealable = Math.max(0, loyDispoPrealable - deduit)
    }

    // Pour les biens proprio : pas d'absorption AUTO/deboursProp/ownerStay (tout en DEB_AE)
    if (bien.mode_encaissement !== 'dcb') continue

    // AUTO depuis ventilation deja chargee en memoire
    const autoBien = ventilation
      .filter(function(l) { return l.bien_id === bien.id && l.code === 'AUTO' })
      .reduce(function(s, l) { return s + (l.montant_reel !== null ? l.montant_reel : (l.montant_ht || 0)) }, 0)
    // MEN de ce bien : AUTO est deja deduit du MEN pour donner FMEN
    // La part AUTO couverte par MEN ne touche pas le LOY du proprio (CAS DCB)
    // Exclure le MEN des owner stays (saisie manuelle refacturée au proprio via l'absorption
    // owner stay — pas un ménage collecté auprès d'un voyageur)
    const menBien = ventilation
      .filter(function(l) { return l.bien_id === bien.id && l.code === 'MEN' && !osAllIds.has(l.reservation_id) })
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

  // Totaux facture — en mode Lauian, FMEN est facturé par DCB (pas par Lauian)
  const inclureFMEN = AGENCE !== 'lauian'
  const totalHT  = com.ht  + (inclureFMEN ? menConsolide.ht  : 0) + div.ht  + haownerHT  + (inclureFMEN ? osFmenSurplusHT  : 0) + fraisDirectHTFacture
  const totalTVA = com.tva + (inclureFMEN ? menConsolide.tva : 0) + div.tva + haownerTVA + (inclureFMEN ? osFmenSurplusTVA : 0) + fraisDirectTVAFacture
  const totalTTC = totalHT + totalTVA

  // ownerStayAbsorbTotal = part couverte par LOY → réduit le reversement
  // autoAbsorbableTotal  = AUTO couvert par LOY → réduit le reversement (surplus facturé en DEB_AE séparé)
  // owner stay surplus = facturé séparément → ne réduit pas le reversement
  // fraisDirectTTCReversement : en contexte Lauian, uniquement facturer_et_deduire (déduction LOY)
  const montantReversement = Math.max(0, vir.ht - totalPrestations - haownerTTC - fraisDirectTTCReversement - fraisDeduitTotal - deboursPropAbsorbTotal - ownerStayAbsorbTotal - autoAbsorbableTotal) + remboursementsTotal

  // Cas solde nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©gatif : uniquement des expenses, pas de rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servations

  // ── skip_facturation : biens internes (ex: biens persos du gérant) ──────────
  // DCB finance tout, 0 charges à facturer. Si resas directes → facture 0€ avec reversement uniquement.
  const allSkipFacturation = biens.every(b => b.skip_facturation)
  if (allSkipFacturation) {
    const existingSkip = ctx.facturesExistantes.get(`${proprio.id}__${bienId ?? 'null'}__honoraires`) ?? null
    if (existingSkip && ['envoye_evoliz', 'payee'].includes(existingSkip.statut)) return { created: false, skipped: true }
    if (montantReversement === 0) {
      if (existingSkip && existingSkip.statut === 'brouillon') {
        await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', existingSkip.id)
        await supabase.from('facture_evoliz').delete().eq('id', existingSkip.id)
      }
      return { skipped: true }
    }
    const skipData = { mois, agence: AGENCE, proprietaire_id: proprio.id, bien_id: bienId,
      type_facture: 'honoraires', total_ht: 0, total_tva: 0, total_ttc: 0,
      montant_reversement: montantReversement, statut: 'brouillon', solde_negatif: false }
    let skipFactureId
    if (existingSkip) {
      await supabase.from('facture_evoliz').update(skipData).eq('id', existingSkip.id)
      skipFactureId = existingSkip.id
    } else {
      const { data: nf, error } = await supabase.from('facture_evoliz').insert(skipData).select('id').single()
      if (error) throw error
      skipFactureId = nf.id
    }
    await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', skipFactureId)
    return { created: !existingSkip, factureId: skipFactureId, totalHT: 0, totalTTC: 0, resteAPayer: 0 }
  }
  const soldeNegatif = totalHT === 0 && div.ht > 0
  // total_ht négatif (ajustement réservation "hébergement"/"ménage" très négatif, voir
  // migration 222-225) : une vraie facture ne peut pas avoir un total négatif — on la crée
  // quand même (transparence, lignes visibles) mais flaguée pour report manuel sur le mois
  // suivant plutôt qu'un envoi Evoliz tel quel.
  const aReporter = totalHT < 0
  const [anneeMois, moisMois] = mois.split('-').map(Number)
  const moisSuivant = moisMois === 12 ? `${anneeMois + 1}-01` : `${anneeMois}-${String(moisMois + 1).padStart(2, '0')}`

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
    // Rafraîchir la ligne mémo VIRP même si la facture est déjà envoyée à Evoliz
    await supabase.from('facture_evoliz_ligne').delete()
      .eq('facture_id', existingFacture.id).eq('code', 'VIRP')
    if (virProprioEncaisse > 0) {
      await supabase.from('facture_evoliz_ligne').insert({
        facture_id: existingFacture.id,
        code: 'VIRP',
        libelle: 'Loyers perçus directement par le propriétaire — mémo',
        description: 'Airbnb / Booking : montant encaissé directement par le propriétaire, non transitant par DCB.',
        montant_ht: virProprioEncaisse,
        taux_tva: null,
        montant_tva: 0,
        montant_ttc: virProprioEncaisse,
        ordre: 98,
      })
    }
    // Supprimer l'ancienne ligne RECAP si elle existe (remplacée par le contrôle virements UI)
    await supabase.from('facture_evoliz_ligne').delete()
      .eq('facture_id', existingFacture.id).eq('code', 'RECAP')
    return { created: false, skipped: true, raison: 'Facture déjà envoyée' }
  }

  const factureData = {
    mois,
    agence: AGENCE,
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
    a_reporter: aReporter,
    note: aReporter ? `Total négatif — à reporter sur ${moisSuivant}` : null,
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

  // !== 0 (pas > 0) : un ajustement réservation "hébergement" très négatif (ex. faute agence,
  // Resolution Center) peut rendre com.ht négatif pour le mois — la ligne doit rester visible
  // (crédit), sinon la facture (total_ht) ne correspondrait plus à la somme de ses lignes.
  if (com.ht !== 0) {
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

  // FMEN exclu des factures Lauian — c'est DCB qui facture le ménage aux proprios Lauian
  // !== 0 : idem HON — un ajustement "ménage" très négatif peut rendre menConsolide.ht négatif.
  if (menConsolide.ht !== 0 && AGENCE !== 'lauian') {
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
  // En mode Lauian, fraisDirectPourFacture = [] → boucle vide (DCB facture via lauian_fmen)
  for (const frais of (fraisDirectPourFacture || [])) {
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

  // Owner stay FMEN surplus : ligne prestation de service par bien (TVA 20%) — exclu en mode Lauian
  for (const [, { osFmenSurplus, bienName }] of (AGENCE !== 'lauian' ? ownerStaySurplusByBien : new Map())) {
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

  // Ligne mémo VIRP : loyers perçus directement par le proprio (Airbnb/Booking, non transitant par DCB)
  if (virProprioEncaisse > 0) {
    lignes.push({
      facture_id: factureId,
      code: 'VIRP',
      libelle: 'Loyers perçus directement par le propriétaire — mémo',
      description: 'Airbnb / Booking : montant encaissé directement par le propriétaire, non transitant par DCB.',
      montant_ht: virProprioEncaisse,
      taux_tva: null,
      montant_tva: 0,
      montant_ttc: virProprioEncaisse,
      ordre: 98,
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
  // facturer_et_deduire : facturés ET déduits du LOY
  // En mode Lauian : fraisDirectPourFacture = [] → aucun marquage (DCB le fait via lauian_fmen)
  for (const frais of (fraisDirectPourFacture || [])) {
    const etDeduire = frais.mode_traitement === 'facturer_et_deduire'
    await supabase.from('frais_proprietaire')
      .update({
        statut:             'facture',
        montant_deduit_loy: etDeduire ? frais.montant_ttc : 0,
        montant_reliquat:   etDeduire ? 0 : frais.montant_ttc,
        statut_deduction:   etDeduire ? 'totalement_deduit' : 'non_deduit',
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

  // skip_facturation : pas de DEB_AE pour les biens internes (charge DCB absorbée)
  if (biens.every(b => b.skip_facturation)) return null

  // Données lues depuis le contexte préchargé (pas de requêtes Supabase ici)
  const ventilAuto = ctx.ventilationGlobale.filter(
    v => bienIds.includes(v.bien_id) && (v.code === 'AUTO' || v.code === 'LOY' || v.code === 'MEN')
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
    .in('mode_traitement', ['facturer_direct', 'facturer_et_deduire'])
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

    // Vérifier si ce bien a des débours à facturer même sans ventilation AUTO
    const bienPrestPeek  = prestByBien.get(bien.id) || []
    const deboursPropTotal = bienPrestPeek
      .filter(function(p) {
        return p.type_imputation === 'debours_proprio' || p.type_imputation === 'deduction_loy'
      })
      .reduce(function(s, p) { return s + (p.montant || 0) }, 0)

    if (autoBien === 0 && osAutoHT === 0 && deboursPropTotal === 0) continue

    let montantAFacturer = 0
    let debPropSurplus   = 0
    let debPropItems     = []
    let osAutoSurplus    = 0

    if (bien.mode_encaissement === 'proprio') {
      const bienPrest = prestByBien.get(bien.id) || []
      // LOY disponible en mode proprio (direct/manual uniquement — ici depuis bienVentil)
      const loyBienProprio = bienVentil
        .filter(function(l) { return l.code === 'LOY' })
        .reduce(function(s, l) { return s + l.montant_ht }, 0)
      // debours_proprio : toujours surplus total (pas de LOY DCB à absorber)
      const debPropRaw = bienPrest.filter(function(p) { return p.type_imputation === 'debours_proprio' })
      // deduction_loy sans LOY absorbable (0 résa) → créance, traiter comme surplus DEBP
      const deductionLoyOrphans = loyBienProprio === 0
        ? bienPrest.filter(function(p) { return p.type_imputation === 'deduction_loy' })
        : []
      debPropItems = debPropRaw.concat(deductionLoyOrphans)
      debPropSurplus = debPropItems.reduce(function(s, p) { return s + (p.montant || 0) }, 0)
      montantAFacturer = autoBien + osAutoHT + debPropSurplus
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

      // deduction_loy (main d'oeuvre, ex. menage de fond) non couvert par le LOY dispo
      // (haowner deja toujours facture independamment, cf. ligne HAOWNER honoraires) -> créance
      // a facturer en DEBP, symetrique du cas bien.mode_encaissement === 'proprio'
      const prestBienItems   = bienPrest.filter(function(p){ return p.type_imputation === 'deduction_loy' })
      const prestBienCouvert = Math.min(prestBien, Math.max(0, loyBien - haownerBienTTC))
      const prestBienReliquat = prestBien - prestBienCouvert

      // debours_proprio : absorbe le LOY résiduel après AUTO
      const debProprioItems = bienPrest.filter(function(p){ return p.type_imputation === 'debours_proprio' })
      debPropItems = prestBienReliquat > 0 ? debProprioItems.concat(prestBienItems) : debProprioItems
      const deboursPropBien = debProprioItems.reduce(function(s,p){ return s + (p.montant || 0) }, 0)
      const loyApresAuto    = Math.max(0, loyBienDisponible - autoAbsorbable)
      const debPropAbsorb   = Math.min(deboursPropBien, loyApresAuto)
      debPropSurplus        = Math.max(0, deboursPropBien - debPropAbsorb) + prestBienReliquat
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
    // En mode Lauian : ces frais DCB sont facturés par DCB via lauian_fmen — exclus du débours Lauian
    const fraisDirectsBien = AGENCE === 'lauian' ? [] : (fraisDirectsByBien.get(bien.id) || [])
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
    agence:              AGENCE,
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
    // En mode Lauian : ces frais DCB sont gérés par DCB (lauian_fmen) — ne pas les marquer ici
    if (AGENCE !== 'lauian') {
      const fraisDirectsIds = (fraisDirectsAll || []).map(f => f.id)
      if (fraisDirectsIds.length > 0) {
        await supabase.from('frais_proprietaire')
          .update({ statut: 'facture' })
          .in('id', fraisDirectsIds)
      }
    }
  }

  return { created, factureId, totalHT, totalTTC: totalHT }
}

/**
 * Génère (DCB context) la facture FMEN pour un bien Lauian
 * DCB est prestataire ménage pour tous les biens Lauian — facturation séparée de la facture Lauian
 */
async function genererFactureLauianFMEN(proprio, biens, mois, ctx) {
  const bienIds = biens.map(function(b) { return b.id })
  const bienId  = biens.length === 1 ? biens[0].id : null

  const fmenVentil = ctx.ventilationGlobale.filter(function(v) {
    return bienIds.includes(v.bien_id) && v.code === 'FMEN'
  })
  // ── FMEN du mois — par résa, dans l'ordre : RÉEL > PROVISION > REPORT ─────
  // Réel = FMEN.montant_reel (posé par update-ventilation-auto = FMEN prévu + AUTO prévu
  // − AUTO réel). Provision = montant_ttc (calculé avec bien.provision_ae_ref).
  // Ni réel ni provision (AUTO à 0) → résa REPORTÉE : facturée dès que le réel arrive
  // (rattrapage M+1). L'invariant « réel ≤ provision » garantit qu'on ne surfacture jamais.
  const autoByResa = new Map()
  for (const v of ctx.ventilationGlobale) {
    if (bienIds.includes(v.bien_id) && v.code === 'AUTO') autoByResa.set(v.reservation_id, v)
  }
  const fmenInclus  = [] // { id, ttc, ht, tva }
  const fmenReporte = [] // ventilation ids sans réel ni provision
  for (const v of fmenVentil) {
    let ttc = null
    if (v.montant_reel != null) {
      ttc = v.montant_reel
    } else {
      const auto = autoByResa.get(v.reservation_id)
      // Pas de ligne AUTO = ventilation antérieure au mécanisme → comportement historique (prévu)
      const provisionConnue = !auto || (auto.montant_ht || 0) > 0
      if (provisionConnue) ttc = v.montant_ttc || 0
    }
    if (ttc === null) { fmenReporte.push(v.id); continue }
    const ht = Math.round(ttc / 1.20)
    fmenInclus.push({ id: v.id, ttc: ttc, ht: ht, tva: ttc - ht })
  }
  const fmenHT  = fmenInclus.reduce(function(s, l) { return s + l.ht  }, 0)
  const fmenTVA = fmenInclus.reduce(function(s, l) { return s + l.tva }, 0)
  const fmenTTC = fmenInclus.reduce(function(s, l) { return s + l.ttc }, 0)

  // ── Rattrapages / ajustements des mois antérieurs (facture déjà envoyée) ──
  // Rattrapage : résa reportée (fmen_facture null) dont le réel est arrivé → facturée en entier.
  // Ajustement : résa facturée (fmen_facture) dont l'effectif a changé → delta (≥ 0 si réel ≤ provision).
  const [{ data: pastFactures }, { data: pastFmen }] = await Promise.all([
    supabase.from('facture_evoliz')
      .select('mois, statut').eq('proprietaire_id', proprio.id)
      .eq('type_facture', 'lauian_fmen').lt('mois', mois),
    supabase.from('ventilation')
      .select('id, bien_id, mois_comptable, montant_ttc, montant_reel, fmen_facture, reservation:reservation_id(code)')
      .in('bien_id', bienIds).eq('code', 'FMEN')
      .gte('mois_comptable', '2026-04').lt('mois_comptable', mois),
  ])
  const moisEnvoyes = new Set((pastFactures || [])
    .filter(function(f) { return ['envoye_evoliz', 'payee'].includes(f.statut) })
    .map(function(f) { return f.mois }))
  const ajustements = [] // { id, ttc, effectif, libelle }
  for (const v of (pastFmen || [])) {
    if (!moisEnvoyes.has(v.mois_comptable)) continue // mois pas encore facturé → sa propre facture s'en charge
    const resaCode = v.reservation?.code || ''
    if (v.fmen_facture == null) {
      if (v.montant_reel != null) {
        ajustements.push({ id: v.id, ttc: v.montant_reel, effectif: v.montant_reel,
          libelle: `Rattrapage ménage ${resaCode} (${v.mois_comptable})` })
      }
      continue
    }
    const effectif = v.montant_reel != null ? v.montant_reel : (v.montant_ttc || 0)
    const delta = effectif - v.fmen_facture
    if (delta !== 0) {
      ajustements.push({ id: v.id, ttc: delta, effectif: effectif,
        libelle: `Ajustement ménage ${resaCode} (${v.mois_comptable})` })
    }
  }
  const ajustHT  = ajustements.reduce(function(s, a) { return s + Math.round(a.ttc / 1.20) }, 0)
  const ajustTTC = ajustements.reduce(function(s, a) { return s + a.ttc }, 0)
  const ajustTVA = ajustTTC - ajustHT

  // Frais directs DCB→proprio Lauïan (facturer_direct ou facturer_et_deduire saisis depuis dcb-compta)
  const fraisDirect = ctx.fraisGlobaux.filter(function(f) {
    return bienIds.includes(f.bien_id) &&
      ['facturer_direct', 'facturer_et_deduire'].includes(f.mode_traitement) &&
      f.mode_encaissement === 'dcb' &&
      ['a_facturer', 'facture'].includes(f.statut)
  })
  const fraisDirectTTC = fraisDirect.reduce(function(s, f) { return s + (f.montant_ttc || 0) }, 0)
  const fraisDirectHT  = Math.round(fraisDirectTTC / 1.20)
  const fraisDirectTVA = fraisDirectTTC - fraisDirectHT

  if (fmenHT === 0 && fraisDirect.length === 0 && ajustements.length === 0) return null

  const existing = ctx.facturesExistantes.get(
    `${proprio.id}__${bienId ?? 'null'}__lauian_fmen`
  ) ?? null

  if (existing && ['envoye_evoliz', 'payee'].includes(existing.statut)) {
    return { created: false, skipped: true }
  }

  const libelleGroupe = biens.length === 1 ? biens[0].hospitable_name : biens.map(function(b) { return b.code }).join(', ')

  const totalHT  = fmenHT  + fraisDirectHT  + ajustHT
  const totalTVA = fmenTVA + fraisDirectTVA + ajustTVA
  const totalTTC = fmenTTC + fraisDirectTTC + ajustTTC

  const factureData = {
    proprietaire_id:     proprio.id,
    mois,
    agence:              AGENCE,
    bien_id:             bienId,
    type_facture:        'lauian_fmen',
    total_ht:            totalHT,
    total_tva:           totalTVA,
    total_ttc:           totalTTC,
    montant_reversement: null,
    statut:              'brouillon',
    solde_negatif:       false,
  }

  let factureId
  let created = false

  if (existing) {
    await supabase.from('facture_evoliz').update(factureData).eq('id', existing.id)
    factureId = existing.id
  } else {
    const { data: newFacture } = await supabase
      .from('facture_evoliz').insert(factureData).select('id').single()
    if (!newFacture?.id) throw new Error(
      `genererFactureLauianFMEN: INSERT failed — proprio=${proprio.id} mois=${mois}`
    )
    factureId = newFacture.id
    created = true
  }

  await supabase.from('facture_evoliz_ligne').delete().eq('facture_id', factureId)

  const lignes = []
  let ordre = 1

  if (fmenHT !== 0) {
    lignes.push({
      facture_id:  factureId,
      code:        'FMEN',
      libelle:     'Forfait ménage, linge et frais de service — prestation DCB',
      description: `${libelleGroupe} — ménage géré par DCB — ${mois}`,
      montant_ht:  fmenHT,
      taux_tva:    20,
      montant_tva: fmenTVA,
      montant_ttc: fmenTTC,
      ordre:       ordre++,
    })
  }

  // Rattrapages / ajustements des mois antérieurs — une ligne par résa (traçabilité)
  for (const a of ajustements) {
    const ht = Math.round(a.ttc / 1.20)
    lignes.push({
      facture_id:  factureId,
      code:        'FMEN',
      libelle:     a.libelle,
      description: `Coût AE réel saisi après facturation — ${libelleGroupe}`,
      montant_ht:  ht,
      taux_tva:    20,
      montant_tva: a.ttc - ht,
      montant_ttc: a.ttc,
      ordre:       ordre++,
    })
  }

  for (const frais of fraisDirect) {
    const ht  = Math.round(frais.montant_ttc / 1.20)
    const tva = frais.montant_ttc - ht
    lignes.push({
      facture_id:  factureId,
      code:        'FRAIS',
      libelle:     frais.libelle,
      description: `${libelleGroupe} — ${mois}`,
      montant_ht:  ht,
      taux_tva:    20,
      montant_tva: tva,
      montant_ttc: frais.montant_ttc,
      ordre:       ordre++,
    })
  }

  if (lignes.length > 0) {
    await supabase.from('facture_evoliz_ligne').insert(lignes)
  }

  // Marquer le FMEN facturé par résa (fmen_facture, TTC) — base du rattrapage/ajustement M+1.
  // Posé à la génération : une régénération du brouillon re-marque aux valeurs courantes ;
  // les factures envoyées ne sont plus régénérées (skip envoye_evoliz), les marques sont figées.
  for (const l of fmenInclus) {
    await supabase.from('ventilation').update({ fmen_facture: l.ttc }).eq('id', l.id)
  }
  for (const a of ajustements) {
    await supabase.from('ventilation').update({ fmen_facture: a.effectif }).eq('id', a.id)
  }
  if (fmenReporte.length > 0) {
    supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'fmen_lauian_reporte', source: 'app', statut: 'ok',
      mois_comptable: mois, proprietaire_id: proprio.id,
      message: `FMEN Lauian ${mois} : ${fmenReporte.length} résa(s) reportée(s) — ni coût AE réel ni provision (rattrapage auto dès saisie du réel)`,
      meta: { ventilation_ids: fmenReporte },
    }).then(null, function() {})
  }
  if (ajustements.length > 0) {
    supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'fmen_lauian_ajustement', source: 'app', statut: 'ok',
      mois_comptable: mois, proprietaire_id: proprio.id,
      message: `FMEN Lauian ${mois} : ${ajustements.length} rattrapage(s)/ajustement(s) mois antérieurs (${(ajustTTC / 100).toFixed(2)} € TTC)`,
      meta: { details: ajustements.map(function(a) { return { ventilation_id: a.id, ttc: a.ttc, libelle: a.libelle } }) },
    }).then(null, function() {})
  }

  // Marquer les frais directs comme facturés
  for (const frais of fraisDirect) {
    if (frais.statut === 'a_facturer') {
      await supabase.from('frais_proprietaire').update({
        statut:             'facture',
        montant_deduit_loy: 0,
        montant_reliquat:   frais.montant_ttc,
        statut_deduction:   'non_deduit',
      }).eq('id', frais.id)
    }
  }

  return { created, factureId, totalHT, totalTTC }
}

export async function getFacturesMois(mois) {
  const { data, error } = await supabase
    .from('facture_evoliz')
    .select(`
      *,
      bien (id, code, agence, gestion_loyer),
      proprietaire (id, nom, prenom, email, iban, id_evoliz, bien!proprietaire_id(id, code, groupe_facturation)),
      facture_evoliz_ligne (*)
    `)
    .eq('mois', mois)
    .eq('agence', AGENCE)
    .in('type_facture', ['honoraires', 'debours', 'lauian_fmen', 'lld'])
    .order('created_at')

  if (error) throw error
  return data || []
}

/**
 * Réouverture de la clôture des biens d'une facture (réservé à Oïhan — enforcé
 * côté edge function reopen-cloture). Déverrouille la saisie prestations/heures.
 * @returns {number} nombre de clôtures réouvertes
 */
export async function reouvrirClotureFacture(facture, motif) {
  if (!motif || !motif.trim()) throw new Error('Un motif est obligatoire pour rouvrir')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session requise')

  // Rouvrir la saisie = la facture envoyée n'est plus valable → on retire d'abord le
  // brouillon T- chez Evoliz. Si Evoliz refuse (facture déjà validée F- / payée), la
  // réouverture est BLOQUÉE : impossible de diverger d'une facture comptabilisée
  // (le recours est un avoir chez Evoliz).
  if (['envoye_evoliz', 'payee'].includes(facture.statut) && facture.id_evoliz && facture.id_evoliz !== 'N/A') {
    try {
      await evolizCall('deleteInvoice', { invoiceId: facture.id_evoliz })
    } catch (e) {
      throw new Error(`Réouverture refusée : le brouillon Evoliz ${facture.numero_facture || facture.id_evoliz} n'a pas pu être supprimé (probablement déjà validé/payé — passez par un avoir). Détail : ${e.message}`)
    }
    await supabase.from('facture_evoliz')
      .update({ statut: 'brouillon', id_evoliz: null, numero_facture: null })
      .eq('id', facture.id)
    logOp({
      categorie: 'facture', action: 'delete', statut: 'ok', source: 'app',
      mois_comptable: facture.mois, bien_id: facture.bien_id || null, proprietaire_id: facture.proprietaire_id || null,
      message: `Réouverture saisie : brouillon Evoliz ${facture.numero_facture || facture.id_evoliz} supprimé, facture repassée en brouillon (motif : ${motif.trim()})`,
    })
  }

  let bienIds = []
  if (facture.bien_id) bienIds = [facture.bien_id]
  else if (facture.proprietaire_id) {
    const { data } = await supabase.from('bien').select('id').eq('proprietaire_id', facture.proprietaire_id)
    bienIds = (data || []).map(b => b.id)
  }
  if (!bienIds.length) throw new Error('Aucun bien à rouvrir pour cette facture')
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reopen-cloture`
  let reopened = 0
  for (const bien_id of bienIds) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ bien_id, mois: facture.mois, motif: motif.trim() }),
    })
    if (r.ok) { const j = await r.json(); reopened += j.reopened || 0 }
    else if (r.status === 403) throw new Error('Réouverture réservée à Oïhan')
    // 404 (pas de clôture active sur ce bien) → ignoré
  }
  return reopened
}

/**
 * Envoie un email au proprio pour un débours AE sur bien sans gestion loyer.
 * Template calqué sur les emails contrats PowerHouse.
 * Oïhan est automatiquement en CC (géré par smtp-send).
 */
export async function envoyerEmailDeboursProprio(facture) {
  const proprio = facture.proprietaire
  const bien = facture.bien
  const mois = facture.mois

  if (!proprio?.email) throw new Error(`Pas d'email pour ${proprio?.nom}`)

  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year

  const lignes = facture.facture_evoliz_ligne || []
  // Total à rembourser = TOUTES les lignes de la facture de débours (DEB_AE honoraires AE,
  // DEBP débours proprio ex. ménage de fond, FRAIS divers). Le filtre sur DEB_AE seul ratait
  // les débours proprio → 0,00 € sur les biens en mode_encaissement='proprio' (ex. VIKY/DEBP).
  const montantDebAE = lignes
    .reduce((sum, l) => sum + (l.montant_ttc || l.montant_ht || 0), 0)

  const montantEur = (Math.abs(montantDebAE) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const bienNom = bien?.code || proprio?.nom || 'votre bien'
  const ref = `DEBOURS-AE-${bienNom.replace(/[^A-Z0-9]/gi, '-').toUpperCase()}-${mois}`
  const prenom = proprio.prenom || proprio.nom
  const billing = await getAgencyBillingConfig()
  const footerLegal = AGENCE === 'dcb'
    ? 'Destination Côte Basque SARL · RCS Bayonne 904 781 671 · 6 allée des Chênes, 64200 Biarritz'
    : `${AGENCE_BRAND.label} · SIRET ${billing.siret} · ${billing.adresse}`

  // Générer URL de confirmation signée (HMAC-SHA256, valable 30 jours)
  const confirmUrl = await (async () => {
    try {
      const secret = import.meta.env.VITE_DEBOURS_CONFIRM_SECRET
      if (!secret) return null
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${facture.id}:${expiry}`))
      const hmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
      const token = btoa(`${facture.id}:${expiry}:${hmac}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-virement-debours?token=${token}`
    } catch { return null }
  })()

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;box-shadow:0 2px 12px rgba(44,36,22,0.08)">
        <tr><td style="background:#CC9933;padding:30px 40px;text-align:center">
          <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">${AGENCE_BRAND.label}</p>
          <p style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:bold;letter-spacing:0.3px">Remboursement débours AE</p>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${bienNom} · ${moisLabel}</p>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 20px;font-size:15px;color:#2C2416">Bonjour ${prenom},</p>
          <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.7">
            Dans le cadre de la gestion de votre bien <strong style="color:#2C2416">${bienNom}</strong>, ${AGENCE_BRAND.label} a avancé pour votre compte les honoraires de l'auto-entrepreneur pour le mois de <strong style="color:#2C2416">${moisLabel}</strong>.
          </p>
          <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px">
            <tr>
              <td style="background:#FBF5E6;border:1.5px solid #CC9933;border-radius:8px;padding:20px 28px;text-align:center">
                <div style="font-size:11px;color:#9C8E7D;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Montant à rembourser</div>
                <div style="font-size:32px;font-weight:bold;color:#CC9933;letter-spacing:0.5px">${montantEur} €</div>
                <div style="font-size:12px;color:#9C8E7D;margin-top:6px">Débours auto-entrepreneur — ${moisLabel}</div>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 14px;font-size:14px;font-weight:600;color:#2C2416">Merci d'effectuer un virement depuis votre compte séquestre :</p>
          <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;background:#f9f6f0;border-radius:8px;overflow:hidden">
            <tr><td style="padding:20px 24px">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom:12px">
                    <div style="font-size:10px;color:#9C8E7D;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">IBAN destinataire (séquestre)</div>
                    <div style="font-size:15px;font-family:'Courier New',monospace;color:#2C2416;font-weight:600;letter-spacing:2px">${billing.iban}</div>
                  </td>
                </tr>
                <tr>
                  <td style="border-top:1px solid #EDEBE5;padding-top:12px;padding-bottom:12px">
                    <div style="font-size:10px;color:#9C8E7D;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">BIC</div>
                    <div style="font-size:14px;font-family:'Courier New',monospace;color:#2C2416">${billing.bic}</div>
                  </td>
                </tr>
                <tr>
                  <td style="border-top:1px solid #EDEBE5;padding-top:12px">
                    <div style="font-size:10px;color:#9C8E7D;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px">Référence à indiquer</div>
                    <div style="font-size:13px;font-family:'Courier New',monospace;color:#CC9933;font-weight:600">${ref}</div>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;font-size:12px;color:#9C8E7D;line-height:1.6;border-top:1px solid #EDEBE5;padding-top:20px">
            Ce remboursement est distinct de votre reversement de loyer habituel. Il correspond aux débours avancés par ${AGENCE_BRAND.label} pour le compte de l'auto-entrepreneur intervenant sur votre bien.
          </p>

          ${confirmUrl ? '<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="background:#9EB39A;border-radius:6px;padding:14px 32px"><a href="' + confirmUrl + '" style="color:#fff;text-decoration:none;font-size:15px;font-weight:bold">✓ Confirmer mon virement →</a></td></tr></table><p style="text-align:center;margin:12px 0 0;font-size:11px;color:#9C8E7D">Cliquez une fois votre virement effectué</p>' : ''}
        </td></tr>
        <tr><td style="background:#f9f6f0;border-top:2px solid #CC9933;padding:18px 40px;text-align:center">
          <p style="margin:0;font-size:11px;color:#9C8E7D">${footerLegal}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smtp-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      to: [proprio.email],
      ...(AGENCE === 'lauian' ? { cc: ['laura@destinationcotebasque.com'] } : {}),
      subject: `Remboursement débours auto-entrepreneur — ${moisLabel} — ${bienNom}`,
      html,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`smtp-send: ${err}`)
  }

  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'envoye_proprio', envoye_proprio_at: new Date().toISOString(), nb_relances: 0, derniere_relance_at: null })
    .eq('id', facture.id)
  if (error) throw error
  return true
}


/**
 * Valide une facture (passage brouillon ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ validÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©)
 */
/**
 * Envoie un email informatif au proprio pour une facture honoraires sur bien sans gestion loyer.
 * Récapitule les charges du mois — pas de virement demandé, juste une info.
 * Oïhan est automatiquement en CC (géré par smtp-send).
 */
export async function envoyerEmailChargesProprio(facture) {
  const proprio = facture.proprietaire
  const bien = facture.bien
  const mois = facture.mois

  if (!proprio?.email) throw new Error(`Pas d'email pour ${proprio?.nom}`)

  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const [year, monthIdx] = mois.split('-')
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year
  const bienNom = bien?.code || proprio?.nom || 'votre bien'
  const prenom = proprio.prenom || proprio.nom

  // Lignes significatives (hors mémos)
  const CODES_MEMO = ['AUTO', 'VIRP']
  const lignes = (facture.facture_evoliz_ligne || [])
    .filter(l => !CODES_MEMO.includes(l.code) && l.montant_ht !== 0)
    .sort((a, b) => (a.ordre || 0) - (b.ordre || 0))

  const totalTTC = facture.total_ttc || 0
  const totalEur = (Math.abs(totalTTC) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const lignesRows = lignes.map(l => {
    const ht = (l.montant_ht / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const ttc = (l.montant_ttc / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const isNegatif = l.montant_ht < 0
    return `<tr style="border-bottom:1px solid #EDEBE5">
      <td style="padding:10px 16px;font-size:13px;color:#2C2416">${l.libelle || l.code}</td>
      <td style="padding:10px 16px;font-size:13px;text-align:right;font-family:'Courier New',monospace;color:${isNegatif ? '#059669' : '#2C2416'}">${isNegatif ? '−' : '+'} ${ht} €</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;box-shadow:0 2px 12px rgba(44,36,22,0.08)">
        <tr><td style="background:#CC9933;padding:30px 40px;text-align:center">
          <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
          <p style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:bold;letter-spacing:0.3px">Récapitulatif de charges</p>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${bienNom} · ${moisLabel}</p>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 20px;font-size:15px;color:#2C2416">Bonjour ${prenom},</p>
          <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.7">
            Voici le récapitulatif des charges de gestion pour votre bien <strong style="color:#2C2416">${bienNom}</strong> au titre du mois de <strong style="color:#2C2416">${moisLabel}</strong>.
          </p>
          <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border:1px solid #EDEBE5;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f9f6f0">
                <th style="padding:10px 16px;font-size:10px;color:#9C8E7D;text-align:left;letter-spacing:1px;text-transform:uppercase;font-weight:600">Désignation</th>
                <th style="padding:10px 16px;font-size:10px;color:#9C8E7D;text-align:right;letter-spacing:1px;text-transform:uppercase;font-weight:600">Montant HT</th>
              </tr>
            </thead>
            <tbody>${lignesRows}</tbody>
            <tfoot>
              <tr style="background:#FBF5E6;border-top:2px solid #CC9933">
                <td style="padding:14px 16px;font-size:14px;font-weight:700;color:#2C2416">Total TTC</td>
                <td style="padding:14px 16px;font-size:18px;font-weight:bold;color:#CC9933;text-align:right;font-family:'Courier New',monospace">${totalEur} €</td>
              </tr>
            </tfoot>
          </table>

          <p style="margin:0;font-size:13px;color:#666;line-height:1.7">
            Pour toute question concernant ce récapitulatif ou pour convenir des modalités de règlement, n'hésitez pas à contacter Oïhan directement.
          </p>
        </td></tr>
        <tr><td style="background:#f9f6f0;border-top:2px solid #CC9933;padding:18px 40px;text-align:center">
          <p style="margin:0;font-size:11px;color:#9C8E7D">Destination Côte Basque SARL · RCS Bayonne 904 781 671 · 6 allée des Chênes, 64200 Biarritz</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smtp-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      to: [proprio.email],
      subject: `Récapitulatif de charges — ${moisLabel} — ${bienNom}`,
      html,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`smtp-send: ${err}`)
  }
  return true
}


export async function validerFacture(factureId) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'valide' })
    .eq('id', factureId)
    .eq('statut', 'brouillon')

  if (error) throw error
}

/** Toggle inverse : une facture validée (pas encore envoyée à Evoliz) repasse en brouillon. */
export async function devaliderFacture(factureId) {
  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'brouillon' })
    .eq('id', factureId)
    .eq('statut', 'valide')
    .is('id_evoliz', null)

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
    .eq('agence', AGENCE)
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
    .eq('agence', AGENCE)
    .eq('type_facture', 'com')
    .maybeSingle()

  if (existing?.statut === 'envoye_evoliz')
    throw new Error('Facture COM déjà envoyée dans Evoliz — non modifiable.')

  const factureData = {
    mois,
    agence: AGENCE,
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
    .eq('bien.agence', AGENCE)
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
    .select('statut, total_ttc, solde_negatif, bloque_treso')
    .eq('mois', mois)
    .eq('agence', AGENCE)

  const all = factures || []
  return {
    total: all.length,
    // bloquées (loyer LLD non encaissé) : ni validables ni poussables → hors "à valider"
    brouillons: all.filter(f => f.statut === 'brouillon' && !f.bloque_treso).length,
    bloquees: all.filter(f => f.bloque_treso).length,
    valides: all.filter(f => f.statut === 'valide').length,
    envoyes: all.filter(f => f.statut === 'envoye_evoliz').length,
    payes: all.filter(f => f.statut === 'payee').length,
    soldes_negatifs: all.filter(f => f.solde_negatif).length,
    total_ttc: all.reduce((s, f) => s + (f.total_ttc || 0), 0),
  }
}
