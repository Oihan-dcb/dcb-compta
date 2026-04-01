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
        const facture = await genererFactureGroupe(proprio, biens, mois)
        if (facture.skipped) log.skipped++
        else if (facture.created) log.created++
        else log.updated++
        if ((facture.resteAPayer || 0) > 0) log.resteAPayer += facture.resteAPayer

        const debours = await genererFactureDebours(proprio, biens, mois)
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
  const allBienIds = [...propMap.values()].flatMap(function(p){ return p.biens.map(function(b){ return b.id }) })
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
async function genererFactureGroupe(proprio, biens, mois) {
  const bienIds = biens.map(b => b.id)
  const bienId = biens.length === 1 ? biens[0].id : null
  const libelleGroupe = biens.length === 1
    ? biens[0].hospitable_name
    : (biens[0].groupe_facturation === 'MAITE' ? 'Maison Maïté' : biens.map(b => b.code).join(', '))

  // RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer les rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servations du mois pour ces biens
  const { data: reservations, error: resaErr } = await supabase
    .from('reservation')
    .select(`
      id, code, platform, fin_revenue, mois_comptable,
      reservation_fee (fee_type, label, amount, category)
    `)
    .in('bien_id', bienIds)
    .eq('mois_comptable', mois)
    .eq('owner_stay', false)
    .neq('final_status', 'cancelled')
    .gt('fin_revenue', 0)

  if (resaErr) throw resaErr

  // RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rer les expenses [DCB] du mois pour ces biens
  const { data: expenses, error: expErr } = await supabase
    .from('expense')
    .select('amount, description, type_expense')
    .in('bien_id', bienIds)
    .eq('mois_comptable', mois)
    .eq('type_expense', 'DCB')
    .eq('validee', true)

  if (expErr) throw expErr

  // CF-FACAE : facture_ae non implÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©mentÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ© ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ aeParBien = Map vide (table absente en base)
  const aeParBien = new Map()

  // --- Calculer les 3 lignes ---

  // COM : ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ£ ventilation COM du mois
  const { data: lignesVentil } = await supabase
    .from('ventilation')
    .select('code, montant_ht, montant_tva, montant_ttc, montant_reel, bien_id')
    .in('bien_id', bienIds)
    .eq('mois_comptable', mois)

  const ventilation = lignesVentil || []

  const sumByCode = (code) => ventilation
    .filter(l => l.code === code)
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

  // CF-P1 : prestations hors forfait deduction_loy validees -- deduction directe sur reversement
  const { data: prestationsDeduction } = await supabase
    .from('prestation_hors_forfait')
    .select('montant, bien_id, description, prestation_type:prestation_type_id(nom), ae:ae_id(type)')
    .in('bien_id', bienIds)
    .eq('mois', mois)
    .eq('statut', 'valide')
    .eq('type_imputation', 'deduction_loy')
  const totalPrestations = (prestationsDeduction || []).reduce((s, p) => {
    const isStaff = p.ae?.type === 'staff'
    return s + (isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0))
  }, 0)

  // CF-P1 HAOWNER : frais avances DCB refactures au proprietaire (TVA 20%)
  const { data: prestationsHaowner } = await supabase
    .from('prestation_hors_forfait')
    .select('montant, bien_id, description, prestation_type:prestation_type_id(nom)')
    .in('bien_id', bienIds)
    .eq('mois', mois)
    .eq('statut', 'valide')
    .eq('type_imputation', 'haowner')
  const haownerHT  = (prestationsHaowner || []).reduce((s, p) => s + (p.montant || 0), 0)
  const haownerTVA = Math.round(haownerHT * 0.20)
  const haownerTTC = haownerHT + haownerTVA

  // CF-P1 debours_proprio : absorption LOY (après AUTO), surplus → facture DEBP
  const { data: prestationsDeboursProprio } = await supabase
    .from('prestation_hors_forfait')
    .select('montant, bien_id, description, prestation_type:prestation_type_id(nom), ae:ae_id(type)')
    .in('bien_id', bienIds)
    .eq('mois', mois)
    .eq('statut', 'valide')
    .eq('type_imputation', 'debours_proprio')

  // Frais propriétaire à déduire du loyer (mode_traitement = 'deduire_loyer')
  const { data: fraisDeduire } = await supabase
    .from('frais_proprietaire')
    .select('id, montant_ttc, bien_id, libelle')
    .in('bien_id', bienIds)
    .eq('mois_facturation', mois)
    .eq('mode_traitement', 'deduire_loyer')
    .eq('mode_encaissement', 'dcb')
    .eq('statut', 'a_facturer')
  const fraisDeduireTTC = (fraisDeduire || []).reduce((s, f) => s + (f.montant_ttc || 0), 0)

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

  // Totaux facture
  const totalHT = com.ht + menConsolide.ht + div.ht + haownerHT
  const totalTVA = com.tva + menConsolide.tva + div.tva + haownerTVA
  const totalTTC = totalHT + totalTVA

  // AUTO ÃÂ©tape 1 : absorption bien par bien -- mode_encaissement = 'dcb' uniquement
  let autoAbsorbableTotal = 0
  let autoSurplusTotal    = 0
  let deboursPropAbsorbTotal  = 0
  let deboursPropSurplusTotal = 0

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

    // Frais propriétaire à déduire du loyer de ce bien
    const fraisDeduireBien = (fraisDeduire || [])
      .filter(f => f.bien_id === bien.id)
      .reduce((s, f) => s + (f.montant_ttc || 0), 0)

    // AUTO depuis ventilation deja chargee en memoire
    const autoBien = ventilation
      .filter(function(l) { return l.bien_id === bien.id && l.code === 'AUTO' })
      .reduce(function(s, l) { return s + (l.montant_reel !== null ? l.montant_reel : (l.montant_ht || 0)) }, 0)

    // LOY disponible après déductions de ce bien
    const loyBienDisponible = Math.max(0, loyBien - prestBien - haownerBienTTC - fraisDeduireBien)
    // Absorption et surplus bien par bien
    const autoAbsorbableBien = Math.min(autoBien, loyBienDisponible)
    const autoSurplusBien    = Math.max(0, autoBien - autoAbsorbableBien)

    // debours_proprio : absorbe le LOY résiduel après AUTO
    const deboursPropBien = (prestationsDeboursProprio || [])
      .filter(function(p){ return p.bien_id === bien.id })
      .reduce(function(s,p){ return s + (p.montant || 0) }, 0)
    const loyApresAuto       = Math.max(0, loyBienDisponible - autoAbsorbableBien)
    const deboursPropAbsorb  = Math.min(deboursPropBien, loyApresAuto)
    const deboursPropSurplus = Math.max(0, deboursPropBien - deboursPropAbsorb)

    if (autoBien > 0) {
    }

    autoAbsorbableTotal += autoAbsorbableBien
    autoSurplusTotal    += autoSurplusBien
    deboursPropAbsorbTotal  += deboursPropAbsorb
    deboursPropSurplusTotal += deboursPropSurplus
  }

  const montantReversement = Math.max(0, loy.ht - totalPrestations - haownerTTC - fraisDeduireTTC - autoAbsorbableTotal - deboursPropAbsorbTotal)

  // Cas solde nÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©gatif : uniquement des expenses, pas de rÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©servations
  const soldeNegatif = totalHT === 0 && div.ht > 0

  // VÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©rifier si facture existante
  let existingFactureQuery = supabase
    .from('facture_evoliz')
    .select('id, statut')
    .eq('proprietaire_id', proprio.id)
    .eq('mois', mois)
    .eq('type_facture', 'honoraires')
  if (bienId) existingFactureQuery = existingFactureQuery.eq('bien_id', bienId)
  else existingFactureQuery = existingFactureQuery.is('bien_id', null)
  const { data: existingFacture } = await existingFactureQuery.maybeSingle()

  // Ne pas ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©craser une facture dÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©jÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ  envoyÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©e ou payÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©e
  if (existingFacture && ['envoye_evoliz', 'payee'].includes(existingFacture.statut)) {
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

  // Frais proprietaire deduits du loyer (ligne de transparence)
  for (const frais of (fraisDeduire || [])) {
    lignes.push({
      facture_id:  factureId,
      code:        'FRAIS',
      libelle:     frais.libelle || 'Frais proprietaire',
      montant_ht:  -Math.round(frais.montant_ttc / 1.20),
      taux_tva:    20,
      montant_tva: -(frais.montant_ttc - Math.round(frais.montant_ttc / 1.20)),
      montant_ttc: -frais.montant_ttc,
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

  if (lignes.length > 0) {
    await supabase.from('facture_evoliz_ligne').insert(lignes)
  }

  // Passer les frais à déduire en statut 'facture' (chemin non-skipped uniquement)
  if (fraisDeduire?.length > 0) {
    await supabase.from('frais_proprietaire')
      .update({ statut: 'facture' })
      .in('id', fraisDeduire.map(f => f.id))
  }

  const resteAPayer = Math.max(0, (totalPrestations + haownerTTC) - loy.ht) + autoSurplusTotal + deboursPropSurplusTotal
  return { created, factureId, totalHT, totalTTC, soldeNegatif, resteAPayer }
}

/**
 * RÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©cupÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ¨re toutes les factures d'un mois avec les dÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ©tails
 */
async function genererFactureDebours(proprio, biens, mois) {
  const lignes = []
  let ordre = 1

  const bienIds = biens.map(function(b) { return b.id })
  const bienId = biens.length === 1 ? biens[0].id : null

  // Batch 1 : ventilation AUTO + LOY
  const { data: ventilAuto } = await supabase
    .from('ventilation').select('bien_id, code, montant_ht, montant_reel')
    .in('bien_id', bienIds).eq('mois_comptable', mois).in('code', ['AUTO', 'LOY'])

  // Batch 2 : prestations deduction_loy + haowner + debours_proprio
  const { data: prestationsAll } = await supabase
    .from('prestation_hors_forfait').select('bien_id, montant, type_imputation, ae:ae_id(type)')
    .in('bien_id', bienIds).eq('mois', mois).eq('statut', 'valide')
    .in('type_imputation', ['deduction_loy', 'haowner', 'debours_proprio'])

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

  // Batch 3 : frais_propriétaire à facturer directement
  const { data: fraisDirectsAll } = await supabase
    .from('frais_proprietaire')
    .select('bien_id, id, montant_ttc, libelle')
    .in('bien_id', bienIds)
    .eq('mois_facturation', mois)
    .eq('mode_traitement', 'facturer_direct')
    .eq('mode_encaissement', 'dcb')
    .eq('statut', 'a_facturer')

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

    if (autoBien === 0) continue

    let montantAFacturer = 0
    let debPropSurplus   = 0
    let debPropItems     = []

    if (bien.mode_encaissement === 'proprio') {
      montantAFacturer = autoBien
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
      const autoAbsorbable    = Math.min(autoBien, loyBienDisponible)
      montantAFacturer        = Math.max(0, autoBien - autoAbsorbable)

      // debours_proprio : absorbe le LOY résiduel après AUTO
      debPropItems = bienPrest.filter(function(p){ return p.type_imputation === 'debours_proprio' })
      const deboursPropBien = debPropItems.reduce(function(s,p){ return s + (p.montant || 0) }, 0)
      const loyApresAuto    = Math.max(0, loyBienDisponible - autoAbsorbable)
      const debPropAbsorb   = Math.min(deboursPropBien, loyApresAuto)
      debPropSurplus        = Math.max(0, deboursPropBien - debPropAbsorb)
      montantAFacturer     += debPropSurplus
    }

    if (autoBien > 0) {
    }

    if (montantAFacturer === 0) continue

    const autoSurplusBienDebours = Math.max(0, montantAFacturer - debPropSurplus)
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

  if (lignes.length === 0) return null

  const totalHT = lignes.reduce((s, l) => s + l.montant_ht, 0)

  let existingDebQuery = supabase
    .from('facture_evoliz')
    .select('id, statut')
    .eq('proprietaire_id', proprio.id)
    .eq('mois', mois)
    .eq('type_facture', 'debours')
  if (bienId) existingDebQuery = existingDebQuery.eq('bien_id', bienId)
  else existingDebQuery = existingDebQuery.is('bien_id', null)
  const { data: existing } = await existingDebQuery.maybeSingle()

  if (existing && ['envoye_evoliz', 'payee'].includes(existing.statut)) {
    return { created: false, skipped: true }
  }

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
      proprietaire (id, nom, prenom, email, iban, id_evoliz),
      facture_evoliz_ligne (*)
    `)
    .eq('mois', mois)
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
