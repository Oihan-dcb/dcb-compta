/**
 * buildComptaMensuelle(mois)
 *
 * Moteur de comptabilité mensuelle DCB — vue d'ensemble tous biens.
 * Source de vérité unique pour la page Comptabilité, les exports CSV
 * et tout contrôle comptable futur.
 *
 * Conventions :
 *  - Tous les montants sont en centimes (entiers).
 *  - agence='dcb' uniquement.
 *  - ecart_reversement_proprio est calculé au niveau propriétaire
 *    (même valeur sur toutes les lignes du même proprio) :
 *    facture.montant_reversement − Σ loy_ht de tous ses biens actifs ce mois.
 *
 * Retour :
 *  { mois, rows, totals, alerts, metadata }
 */

import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'
import { STATUTS_NON_VENTILABLES } from '../lib/constants'

export async function buildComptaMensuelle(mois, bienIds = null) {
  // ── Phase 1 : chargement parallèle ──────────────────────────────────────
  let biensQuery = supabase
    .from('bien')
    .select('id, code, hospitable_name, listed, proprietaire_id, groupe_facturation, gestion_loyer, skip_facturation, proprietaire:proprietaire_id(id, nom, prenom)')
    .eq('agence', AGENCE)
  if (bienIds) biensQuery = biensQuery.in('id', bienIds)

  // Missions AE du mois de réalisation (montant réel facturé, pas provision ventilation)
  let missionsQuery = supabase
    .from('mission_menage')
    .select('bien_id, montant, impute_salaire, ae:ae_id(type)')
    .eq('mois', mois)
    .neq('statut', 'cancelled')
    .not('montant', 'is', null)
  if (bienIds) missionsQuery = missionsQuery.in('bien_id', bienIds)

  const [
    { data: biensData,         error: biensErr         },
    { data: resasData,         error: resasErr         },
    { data: ventilData,        error: ventilErr        },
    { data: facturesHon,       error: honErr           },
    { data: facturesDeb,       error: debErr           },
    { data: fraisData,         error: fraisErr         },
    { data: fraisDirectData,   error: fraisDirectErr   },
    { data: remboursData,      error: remboursErr      },
    { data: prestDeductData,   error: prestDeductErr   },
    { data: prestDeboursData,  error: prestDeboursErr  },
    { data: reversementFaitData },
    { data: missionsData },
  ] = await Promise.all([
    biensQuery,
    supabase
      .from('reservation')
      .select('id, bien_id, final_status, ventilation_calculee, rapprochee, owner_stay, fin_revenue, code, arrival_date, departure_date, guest_name, platform')
      .eq('mois_comptable', mois),
    supabase
      .from('ventilation')
      .select('bien_id, code, montant_ht, montant_tva, montant_ttc, montant_reel, reservation_id')
      .eq('mois_comptable', mois)
      .in('code', ['HON', 'FMEN', 'MEN', 'AUTO', 'LOY', 'VIR', 'TAXE', 'COM']),
    supabase
      .from('facture_evoliz')
      .select('id, proprietaire_id, bien_id, statut, total_ht, total_ttc, montant_reversement')
      .eq('mois', mois)
      .eq('type_facture', 'honoraires'),
    supabase
      .from('facture_evoliz')
      .select('id, proprietaire_id, bien_id, statut, total_ht, total_ttc')
      .eq('mois', mois)
      .eq('type_facture', 'debours'),
    // frais déduits du loyer — même filtre que facturesEvoliz.js
    supabase
      .from('frais_proprietaire')
      .select('bien_id, statut, statut_deduction, mode_traitement, montant_ttc, montant_deduit_loy')
      .eq('mois_facturation', mois)
      .eq('mode_encaissement', 'dcb')
      .in('statut', ['a_facturer', 'facture'])
      .in('mode_traitement', ['deduire_loyer', 'facturer_et_deduire']),
    // frais facturés directement au proprio (déduits du reversement)
    supabase
      .from('frais_proprietaire')
      .select('bien_id, statut, montant_ttc')
      .eq('mois_facturation', mois)
      .eq('mode_encaissement', 'dcb')
      .in('statut', ['a_facturer', 'facture'])
      .eq('mode_traitement', 'facturer_direct'),
    // remboursements (ajoutés au reversement)
    supabase
      .from('frais_proprietaire')
      .select('bien_id, statut, montant_ttc')
      .eq('mois_facturation', mois)
      .eq('mode_traitement', 'remboursement')
      .neq('statut', 'brouillon'),
    // prestations déduits du loyer (type_imputation='deduction_loy')
    supabase
      .from('prestation_hors_forfait')
      .select('bien_id, montant, regime, ae:ae_id(type)')
      .eq('mois', mois)
      .eq('type_imputation', 'deduction_loy')
      .eq('statut', 'valide'),
    // prestations débours proprio absorbés
    supabase
      .from('prestation_hors_forfait')
      .select('bien_id, montant, regime')
      .eq('mois', mois)
      .eq('type_imputation', 'debours_proprio')
      .eq('statut', 'valide'),
    // reversements faits (cochés manuellement dans PageComptabilite)
    supabase
      .from('reversement_fait')
      .select('bien_id, fait_at')
      .eq('mois', mois)
      .eq('agence', AGENCE),
    missionsQuery,
  ])

  if (biensErr)  throw new Error(`buildComptaMensuelle — biens: ${biensErr.message}`)
  if (resasErr)  throw new Error(`buildComptaMensuelle — resas: ${resasErr.message}`)
  if (ventilErr) throw new Error(`buildComptaMensuelle — ventilation: ${ventilErr.message}`)
  if (honErr)    throw new Error(`buildComptaMensuelle — factures honoraires: ${honErr.message}`)
  if (debErr)    throw new Error(`buildComptaMensuelle — factures débours: ${debErr.message}`)
  // frais/prestations non bloquants — on continue sans si la requête échoue

  const biens    = biensData    || []
  const resas    = resasData    || []
  const honFacts = facturesHon  || []

  // ── Phase 2 : indexation ─────────────────────────────────────────────────

  // Réservations par bien_id
  const resasByBien = {}
  for (const r of resas) {
    if (!resasByBien[r.bien_id]) resasByBien[r.bien_id] = []
    resasByBien[r.bien_id].push(r)
  }

  // Exclure les lignes ventilation dont la resa est annulée sans frais (orphelines)
  // Ces lignes ne doivent ni contribuer aux totaux ni faire apparaître le bien dans la liste
  const cancelledNoFeeIds = new Set(
    resas
      .filter(r => STATUTS_NON_VENTILABLES.includes(r.final_status) && (r.fin_revenue || 0) === 0)
      .map(r => r.id)
  )
  const ventils = (ventilData || []).filter(v => !v.reservation_id || !cancelledNoFeeIds.has(v.reservation_id))

  // Ventilation agrégée par bien_id + code
  // Pour AUTO : montant_reel si disponible (C3 — reflète le coût AE réel vs estimé)
  const ventilAgg = {}
  for (const v of ventils) {
    const key = `${v.bien_id}::${v.code}`
    if (!ventilAgg[key]) ventilAgg[key] = { ht: 0, tva: 0, ttc: 0 }
    const ht = (v.code === 'AUTO' && v.montant_reel != null) ? v.montant_reel : (v.montant_ht || 0)
    ventilAgg[key].ht  += ht
    ventilAgg[key].tva += (v.montant_tva || 0)
    ventilAgg[key].ttc += (v.montant_ttc || 0)
  }
  const vent = (bienId, code) => ventilAgg[`${bienId}::${code}`] || { ht: 0, tva: 0, ttc: 0 }

  // AUTO HT par bien — calculé depuis mission_menage.montant par mois de réalisation
  // (règle métier : les ménages sont facturés par les AEs le mois de la réalisation,
  //  pas le mois comptable de la réservation)
  const autoByBien = {}
  for (const m of (missionsData || [])) {
    if (m.ae?.type === 'staff') continue  // staff DCB → pas un débours AE externe
    if (m.impute_salaire) continue        // ménage couvert par le salaire de Manon → pas de débours AE
    autoByBien[m.bien_id] = (autoByBien[m.bien_id] || 0) + (m.montant || 0)
  }

  // Factures honoraires — une par bien (bien_id non null) ou une globale (bien_id null)
  // Index par bien_id pour lookup rapide par ligne
  const honByBien = {}
  for (const f of honFacts) if (f.bien_id) honByBien[f.bien_id] = f

  // Index global par proprio (bien_id null) comme fallback
  const honByProprioGlobal = {}
  for (const f of honFacts) if (!f.bien_id) honByProprioGlobal[f.proprietaire_id] = f

  // Somme montant_reversement par proprio (pour l'écart au niveau proprio)
  const reversementFactureParProprio = {}
  for (const f of honFacts) {
    if (f.montant_reversement != null)
      reversementFactureParProprio[f.proprietaire_id] = (reversementFactureParProprio[f.proprietaire_id] || 0) + f.montant_reversement
  }

  // Statut global par proprio : 'validee' si toutes validées, sinon le statut le plus "bas"
  const statutParProprio = {}
  const STATUT_RANK = { valide: 3, envoye_evoliz: 2, brouillon: 1, calcul_en_cours: 0 }
  for (const f of honFacts) {
    const prev = statutParProprio[f.proprietaire_id]
    const rank = STATUT_RANK[f.statut] ?? -1
    if (!prev || rank < (STATUT_RANK[prev] ?? -1)) statutParProprio[f.proprietaire_id] = f.statut
  }

  // Frais déduits du loyer, agrégés par bien_id (même formule que facturesEvoliz.js)
  const fraisLoyByBien = {}
  for (const f of (fraisData || [])) {
    let montant = 0
    if (f.statut === 'facture' && f.statut_deduction !== 'en_attente') montant = f.montant_deduit_loy || 0
    else if (f.statut === 'facture' && f.statut_deduction === 'en_attente') montant = f.montant_ttc || 0
    else if (f.statut === 'a_facturer') montant = f.montant_ttc || 0
    fraisLoyByBien[f.bien_id] = (fraisLoyByBien[f.bien_id] || 0) + montant
  }

  // Frais facturés directement au proprio, agrégés par bien_id
  const fraisDirectByBien = {}
  for (const f of (fraisDirectData || [])) {
    fraisDirectByBien[f.bien_id] = (fraisDirectByBien[f.bien_id] || 0) + (f.montant_ttc || 0)
  }

  // Remboursements, agrégés par bien_id
  const remboursParBien = {}
  for (const f of (remboursData || [])) {
    remboursParBien[f.bien_id] = (remboursParBien[f.bien_id] || 0) + (f.montant_ttc || 0)
  }

  // Prestations deduction_loy par bien_id (staff × 1.20 TVA, autres HT brut)
  const prestDeductByBien = {}
  for (const p of (prestDeductData || [])) {
    if (p.regime === 'sap') continue  // SAP : facturé en parallèle (crédit d'impôt), pas d'imputation proprio
    const isStaff = p.ae?.type === 'staff'
    const montant = isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0)
    prestDeductByBien[p.bien_id] = (prestDeductByBien[p.bien_id] || 0) + montant
  }

  // Prestations débours proprio absorbés par bien_id
  const deboursPropByBien = {}
  for (const p of (prestDeboursData || [])) {
    if (p.regime === 'sap') continue  // SAP : facturé en parallèle, pas d'imputation proprio
    deboursPropByBien[p.bien_id] = (deboursPropByBien[p.bien_id] || 0) + (p.montant || 0)
  }

  // Reversements faits par bien_id → fait_at
  const reversementFaitByBien = {}
  for (const f of (reversementFaitData || [])) {
    reversementFaitByBien[f.bien_id] = f.fait_at
  }

  // Owner stay : FMEN TTC + AUTO HT par bien (depuis ventilation, réservations owner_stay)
  // Identique à facturesEvoliz.js — absorbés par LOY résiduel, réduit le reversement
  // Seuls les owner stays avec fin_revenue > 0 (proprio paie le ménage) sont absorbés sur le LOY.
  // Si fin_revenue = null (séjour gratuit), l'AUTO ne réduit pas le reversement — aligné sur buildRapportData.
  const osResaIds = new Set(resas.filter(r => r.owner_stay && (r.fin_revenue || 0) > 0).map(r => r.id))
  const osVentByBien = {}
  if (osResaIds.size > 0) {
    for (const v of ventils) {
      if (!osResaIds.has(v.reservation_id)) continue
      if (v.code !== 'FMEN' && v.code !== 'AUTO') continue
      if (!osVentByBien[v.bien_id]) osVentByBien[v.bien_id] = { fmenTTC: 0, autoHT: 0 }
      if (v.code === 'FMEN') osVentByBien[v.bien_id].fmenTTC += (v.montant_ttc || 0)
      if (v.code === 'AUTO') osVentByBien[v.bien_id].autoHT += (v.montant_reel != null ? v.montant_reel : (v.montant_ht || 0))
    }
  }

  // Biens actifs ce mois : resas valides (exclure annulées sans frais) ou ventilation valide
  // ou mission_menage AE externe (auto_ht à comptabiliser même sans résa ce mois)
  const biensAvecResas    = new Set(resas.filter(r => !cancelledNoFeeIds.has(r.id)).map(r => r.bien_id))
  const biensAvecVentil   = new Set(ventils.map(v => v.bien_id))
  const biensAvecMissions = new Set((missionsData || []).filter(m => m.ae?.type !== 'staff').map(m => m.bien_id))
  const biensActifs = biens.filter(b => biensAvecResas.has(b.id) || biensAvecVentil.has(b.id) || biensAvecMissions.has(b.id))

  // ── Phase 3 : ownerStayAbsorbByBien + Σ reversement_calcule par proprio ────
  // Formule alignée sur facturesEvoliz.js :
  // reversement = max(0, VIR - fraisLoy - fraisDirect - prestDeduct - haowner - deboursProp - ownerStayAbsorb) + remboursements
  const loyParProprio = {}
  const ownerStayAbsorbByBien = {}
  const composantesParProprio = {}
  for (const b of biensActifs) {
    // LOY résiduel après toutes les déductions standard (ordre = facturesEvoliz)
    const loyHt      = vent(b.id, 'LOY').ht
    const autoHt     = autoByBien[b.id] || 0  // mois de réalisation mission, pas mois_comptable resa
    const fraisLoy   = fraisLoyByBien[b.id]    || 0
    const prestDeduct = prestDeductByBien[b.id] || 0
    const deboursProp = deboursPropByBien[b.id] || 0
    const loyDispo   = Math.max(0, loyHt - prestDeduct - fraisLoy - autoHt - deboursProp)
    // Absorption owner stay AUTO puis FMEN sur LOY résiduel
    const osData       = osVentByBien[b.id] || { fmenTTC: 0, autoHT: 0 }
    const osAutoAbsorb = Math.min(osData.autoHT, loyDispo)
    const osFmenAbsorb = Math.min(osData.fmenTTC, Math.max(0, loyDispo - osAutoAbsorb))
    ownerStayAbsorbByBien[b.id] = osAutoAbsorb + osFmenAbsorb

    if (!b.proprietaire_id) continue
    const virHt2      = vent(b.id, 'VIR').ht
    const fraisDirect = fraisDirectByBien[b.id] || 0
    const rembours    = remboursParBien[b.id]   || 0
    const menHt       = vent(b.id, 'MEN').ht
    const autoAbsorbable = Math.max(0, autoHt - menHt)
    // Source de vérité : facture per-bien si validée, sinon calcul ventilation
    const factureBienP3   = honByBien[b.id]
    const virNet = (factureBienP3?.montant_reversement != null)
      ? factureBienP3.montant_reversement
      : Math.max(0, virHt2 - fraisLoy - fraisDirect - prestDeduct - deboursProp - ownerStayAbsorbByBien[b.id] - autoAbsorbable) + rembours
    loyParProprio[b.proprietaire_id] = (loyParProprio[b.proprietaire_id] || 0) + virNet

    // Accumuler les composantes par proprio pour le détail de l'alerte ECART_REVERSEMENT
    const pid = b.proprietaire_id
    if (!composantesParProprio[pid]) composantesParProprio[pid] = { loy_ht: 0, frais_loy: 0, frais_direct: 0, prest_deduct: 0, debours_prop: 0, owner_stay_absorb: 0, auto_absorbable: 0, remboursements: 0 }
    composantesParProprio[pid].loy_ht           += loyHt
    composantesParProprio[pid].frais_loy        += fraisLoy
    composantesParProprio[pid].frais_direct     += fraisDirect
    composantesParProprio[pid].prest_deduct     += prestDeduct
    composantesParProprio[pid].debours_prop     += deboursProp
    composantesParProprio[pid].owner_stay_absorb += ownerStayAbsorbByBien[b.id]
    composantesParProprio[pid].auto_absorbable  += autoAbsorbable
    composantesParProprio[pid].remboursements   += rembours
  }

  // ── Phase 4 : construction des lignes ────────────────────────────────────
  const rows = []

  for (const b of biensActifs) {
    const propId  = b.proprietaire_id
    const proprio = b.proprietaire
    const propNom = proprio
      ? `${proprio.nom}${proprio.prenom ? ' ' + proprio.prenom : ''}`
      : null

    // Métriques réservations
    const bienResas   = resasByBien[b.id] || []
    const resasGuest  = bienResas.filter(r =>
      !r.owner_stay &&
      (!STATUTS_NON_VENTILABLES.includes(r.final_status) || (r.fin_revenue || 0) > 0) &&
      (b.gestion_loyer !== false || !['airbnb', 'booking'].includes(r.platform))
    )
    const nb_resas            = resasGuest.length
    const nb_rapprochees      = resasGuest.filter(r =>  r.rapprochee).length
    const nb_non_rapprochees  = resasGuest.filter(r => !r.rapprochee).length
    const nb_non_ventilees    = resasGuest.filter(r => !r.ventilation_calculee).length

    // Ventilation
    const hon  = vent(b.id, 'HON')
    const fmen = vent(b.id, 'FMEN')
    const men  = vent(b.id, 'MEN')
    const auto = { ht: autoByBien[b.id] || 0 }  // mois de réalisation mission
    const loy  = vent(b.id, 'LOY')
    const vir  = vent(b.id, 'VIR')
    const taxe = vent(b.id, 'TAXE')
    const com  = vent(b.id, 'COM')

    // Facture du bien : facture spécifique au bien, sinon facture globale du proprio
    const facture = honByBien[b.id] || (propId ? honByProprioGlobal[propId] : null)

    // Reversement calculé par bien — aligné sur facturesEvoliz.js
    const frais_loy       = fraisLoyByBien[b.id]    || 0
    const frais_direct    = fraisDirectByBien[b.id] || 0
    const prest_deduct    = prestDeductByBien[b.id] || 0
    const debours_prop    = deboursPropByBien[b.id] || 0
    const remboursements  = remboursParBien[b.id]   || 0
    const owner_stay_absorb = ownerStayAbsorbByBien[b.id] || 0
    // AUTO absorbable = AUTO non couvert par MEN (fallback Airbnb : MEN=0, AUTO pris sur LOY)
    const auto_absorbable = Math.max(0, auto.ht - men.ht)
    // Source de vérité : facture per-bien si validée (même source que le rapport PDF)
    // Sinon : calcul depuis ventilation VIR
    const factureBien4   = honByBien[b.id]
    const reversement_calcule = (factureBien4?.montant_reversement != null)
      ? factureBien4.montant_reversement
      : Math.max(0, vir.ht - frais_loy - frais_direct - prest_deduct - debours_prop - owner_stay_absorb - auto_absorbable) + remboursements

    // Écart reversement au niveau proprio : Σ factures vs Σ reversement_calcule tous biens
    let ecart_reversement_proprio = null
    if (propId && reversementFactureParProprio[propId] != null) {
      ecart_reversement_proprio = reversementFactureParProprio[propId] - (loyParProprio[propId] || 0)
    }

    // Alertes de la ligne
    const rowAlerts = []

    if (nb_non_ventilees > 0)
      rowAlerts.push({ level: 'warning', code: 'NON_VENTILEES', message: `${nb_non_ventilees} résa(s) non ventilée(s)`, bien_id: b.id })

    // !== 0 (pas > 0) : un ajustement réservation "hébergement" très négatif peut rendre
    // hon.ttc négatif pour le mois — le mérite quand même une facture (ou un report, migration 225).
    if (hon.ttc !== 0 && !facture && !b.skip_facturation)
      rowAlerts.push({ level: 'error', code: 'NO_FACTURE', message: `HON ${(hon.ttc/100).toFixed(2)} € sans facture`, bien_id: b.id })

    // Écart reversement : per-bien si facture per-bien, sinon per-proprio
    const factureBien = honByBien[b.id]
    if (factureBien?.montant_reversement != null) {
      // Facture individuelle pour ce bien → comparaison per-bien
      const ecartBien = factureBien.montant_reversement - reversement_calcule
      const ecartAbs  = Math.abs(ecartBien)
      if (ecartAbs > 100) {
        const sens = ecartBien > 0 ? '+' : ''
        rowAlerts.push({
          level: 'warning',
          code: 'ECART_REVERSEMENT',
          message: `Écart reversement : ${sens}${(ecartBien / 100).toFixed(2)} € (facturé ${(factureBien.montant_reversement / 100).toFixed(2)} € vs calculé ${(reversement_calcule / 100).toFixed(2)} €)`,
          bien_id: b.id,
          details: {
            loy_ht: loy.ht, frais_loy, frais_direct, prest_deduct,
            debours_prop, owner_stay_absorb, auto_absorbable, remboursements,
            reversement_calcule,
            reversement_facture: factureBien.montant_reversement,
          },
        })
      }
    } else if (propId && reversementFactureParProprio[propId] != null && ecart_reversement_proprio != null) {
      // Facture globale pour le proprio → comparaison per-proprio (dédupliquée en Phase 6)
      const ecartAbs = Math.abs(ecart_reversement_proprio)
      if (ecartAbs > 100) {
        const sens = ecart_reversement_proprio > 0 ? '+' : ''
        const rev_facture_eur = (reversementFactureParProprio[propId] / 100).toFixed(2)
        const rev_calcule_eur = ((loyParProprio[propId] || 0) / 100).toFixed(2)
        rowAlerts.push({
          level: 'warning',
          code: 'ECART_REVERSEMENT',
          message: `Écart reversement : ${sens}${(ecart_reversement_proprio / 100).toFixed(2)} € (facturé ${rev_facture_eur} € vs calculé ${rev_calcule_eur} €)`,
          bien_id: b.id,
          details: {
            ...(composantesParProprio[propId] || {}),
            reversement_calcule: loyParProprio[propId] || 0,
            reversement_facture: reversementFactureParProprio[propId] || 0,
          },
        })
      }
    }

    if (nb_non_rapprochees > 0) {
      const resasNonRappr = resasGuest
        .filter(r => !r.rapprochee)
        .map(r => ({
          code:           r.code          || '—',
          arrival_date:   r.arrival_date  || null,
          departure_date: r.departure_date || null,
          fin_revenue:    r.fin_revenue   || 0,
          guest_name:     r.guest_name    || null,
          platform:       r.platform      || null,
        }))
      rowAlerts.push({
        level: 'warning',
        code: 'VIR_SANS_RAPPROCHEMENT',
        message: `${nb_non_rapprochees} virement(s) non rapproché(s)`,
        bien_id: b.id,
        details: { resas: resasNonRappr },
      })
    }

    if (!b.listed && (nb_resas > 0 || hon.ttc > 0 || loy.ht > 0))
      rowAlerts.push({ level: 'warning', code: 'BIEN_INACTIF_AVEC_MOUVEMENTS', message: 'Bien non listé avec mouvements', bien_id: b.id })

    rows.push({
      bien_id:           b.id,
      bien_code:         b.code         || null,
      bien_nom:          b.hospitable_name || null,
      proprietaire_id:   propId         || null,
      proprietaire_nom:  propNom        || null,
      skip_facturation:  b.skip_facturation || false,

      nb_resas,
      nb_rapprochees,
      nb_non_rapprochees,
      nb_non_ventilees,

      hon_ht:   hon.ht,
      hon_tva:  hon.tva,
      hon_ttc:  hon.ttc,
      fmen_ht:  fmen.ht,
      fmen_tva: fmen.tva,
      fmen_ttc: fmen.ttc,
      auto_ht:  auto.ht,
      loy_ht:   loy.ht,
      taxe_ht:  taxe.ht,
      com_ht:   com.ht,
      com_tva:  com.tva,
      com_ttc:  com.ttc,

      frais_loy,
      frais_direct,
      prest_deduct,
      debours_prop,
      owner_stay_absorb,
      auto_absorbable,
      remboursements,
      reversement_calcule,

      groupe_facturation: b.groupe_facturation || null,

      facture_id:                  facture?.id                         ?? null,
      facture_statut:              facture?.statut                      ?? (propId ? statutParProprio[propId] : null) ?? null,
      facture_montant_reversement: facture?.montant_reversement         ?? null,
      ecart_reversement_proprio,

      reversement_fait_at: reversementFaitByBien[b.id] ?? null,

      alert_count: rowAlerts.length,
      alert_level: rowAlerts.some(a => a.level === 'error') ? 'error'
                 : rowAlerts.some(a => a.level === 'warning') ? 'warning'
                 : rowAlerts.length > 0 ? 'info' : null,
      alert_codes: rowAlerts.map(a => a.code),
      alerts: rowAlerts,
    })
  }

  // Tri : par proprietaire_nom puis bien_code
  rows.sort((a, b) => {
    const p = (a.proprietaire_nom || '').localeCompare(b.proprietaire_nom || '')
    if (p !== 0) return p
    return (a.bien_code || '').localeCompare(b.bien_code || '')
  })

  // ── Phase 5 : totaux ──────────────────────────────────────────────────────
  const totals = {
    nb_resas:           rows.reduce((s, r) => s + r.nb_resas,           0),
    nb_rapprochees:     rows.reduce((s, r) => s + r.nb_rapprochees,     0),
    nb_non_rapprochees: rows.reduce((s, r) => s + r.nb_non_rapprochees, 0),
    nb_non_ventilees:   rows.reduce((s, r) => s + r.nb_non_ventilees,   0),
    hon_ht:   rows.reduce((s, r) => s + r.hon_ht,   0),
    hon_tva:  rows.reduce((s, r) => s + r.hon_tva,  0),
    hon_ttc:  rows.reduce((s, r) => s + r.hon_ttc,  0),
    fmen_ht:  rows.reduce((s, r) => s + r.fmen_ht,  0),
    fmen_tva: rows.reduce((s, r) => s + r.fmen_tva, 0),
    fmen_ttc: rows.reduce((s, r) => s + r.fmen_ttc, 0),
    auto_ht:  rows.reduce((s, r) => s + r.auto_ht,  0),
    loy_ht:   rows.reduce((s, r) => s + r.loy_ht,   0),
    taxe_ht:  rows.reduce((s, r) => s + r.taxe_ht,  0),
    com_ht:   rows.reduce((s, r) => s + r.com_ht,   0),
    com_tva:  rows.reduce((s, r) => s + r.com_tva,  0),
    com_ttc:  rows.reduce((s, r) => s + r.com_ttc,  0),
  }

  // ── Phase 6 : alertes globales (dédupliquées au niveau proprio) ───────────
  const alerts = []
  const seen = new Set()
  for (const row of rows) {
    for (const a of row.alerts) {
      // ECART_REVERSEMENT : per-bien si facture per-bien, per-proprio si facture globale
      // NO_FACTURE : toujours per-proprio
      const dedupeKey = a.code === 'NO_FACTURE'
        ? `${a.code}::${row.proprietaire_id}`
        : (a.code === 'ECART_REVERSEMENT' && honByBien[row.bien_id]?.montant_reversement != null)
          ? `${a.code}::bien::${row.bien_id}`
          : (a.code === 'ECART_REVERSEMENT')
            ? `${a.code}::proprio::${row.proprietaire_id}`
            : `${a.code}::${row.bien_id}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      alerts.push({ ...a })
    }
  }
  alerts.sort((a, b) => {
    if (a.level === 'error'   && b.level !== 'error')   return -1
    if (a.level !== 'error'   && b.level === 'error')   return  1
    if (a.level === 'warning' && b.level !== 'warning') return -1
    if (a.level !== 'warning' && b.level === 'warning') return  1
    return a.code.localeCompare(b.code)
  })

  // Frais Stripe du mois — agrégés depuis stripe_payout_line
  let fraisStripe = null
  const { data: mvtsStripe } = await supabase
    .from('mouvement_bancaire')
    .select('id, credit, date_operation')
    .eq('canal', 'stripe')
    .eq('mois_releve', mois)
  if (mvtsStripe?.length) {
    const mvtIds = mvtsStripe.map(m => m.id)
    const { data: stripeLines } = await supabase
      .from('stripe_payout_line')
      .select('mouvement_id, montant_brut, montant_net')
      .in('mouvement_id', mvtIds)
    if (stripeLines?.length) {
      const totalBrut = stripeLines.reduce((s, l) => s + (l.montant_brut || 0), 0)
      const totalNet  = stripeLines.reduce((s, l) => s + (l.montant_net  || 0), 0)
      const totalFrais = totalBrut - totalNet
      const parPayout = {}
      for (const m of mvtsStripe) {
        const lignes = stripeLines.filter(l => l.mouvement_id === m.id)
        if (!lignes.length) continue
        const brut = lignes.reduce((s, l) => s + (l.montant_brut || 0), 0)
        const net  = lignes.reduce((s, l) => s + (l.montant_net  || 0), 0)
        parPayout[m.id] = { date: m.date_operation, credit: m.credit, frais: brut - net }
      }
      fraisStripe = { total: totalFrais, parPayout }
    }
  }

  // FMEN Lauian facturé par DCB — lignes dans le tableau + total stats
  let lauianFmenTotal = { ht: 0, tva: 0, ttc: 0 }
  if (AGENCE === 'dcb') {
    const { data: lauianFacts } = await supabase
      .from('facture_evoliz')
      .select('id, bien_id, proprietaire_id, total_ht, total_tva, total_ttc, statut, bien:bien_id(code, hospitable_name), proprietaire:proprietaire_id(nom, prenom)')
      .eq('mois', mois)
      .eq('agence', 'dcb')
      .eq('type_facture', 'lauian_fmen')
    for (const f of (lauianFacts || [])) {
      lauianFmenTotal.ht  += f.total_ht  || 0
      lauianFmenTotal.tva += f.total_tva || 0
      lauianFmenTotal.ttc += f.total_ttc || 0
      const pNom = f.proprietaire ? `${f.proprietaire.nom}${f.proprietaire.prenom ? ' ' + f.proprietaire.prenom : ''}` : null
      // Ligne spéciale "client Lauian" — apparaît dans le tableau et l'export mais hors totaux DCB
      rows.push({
        bien_id: f.bien_id, bien_code: f.bien?.code || null, bien_nom: f.bien?.hospitable_name || null,
        proprietaire_id: f.proprietaire_id, proprietaire_nom: pNom,
        is_lauian_client: true,
        nb_resas: 0, nb_rapprochees: 0, nb_non_rapprochees: 0, nb_non_ventilees: 0,
        hon_ht: 0, hon_tva: 0, hon_ttc: 0,
        fmen_ht: f.total_ht || 0, fmen_tva: f.total_tva || 0, fmen_ttc: f.total_ttc || 0,
        auto_ht: 0, loy_ht: 0, taxe_ht: 0, com_ht: 0, com_tva: 0, com_ttc: 0,
        frais_loy: 0, frais_direct: 0, prest_deduct: 0, debours_prop: 0,
        owner_stay_absorb: 0, auto_absorbable: 0, remboursements: 0,
        reversement_calcule: 0, groupe_facturation: null,
        facture_id: f.id, facture_statut: f.statut, facture_montant_reversement: null,
        ecart_reversement_proprio: null, reversement_fait_at: null,
        alert_count: 0, alert_level: null, alert_codes: [], alerts: [],
      })
    }
  }

  // Honoraires LLD (locations longue durée) — sous-catégorie dédiée.
  // Lignes hors totaux DCB saisonnier (comme Lauian) : HON = commission LLD,
  // reversement = loyer net reversé au proprio (montant_reversement).
  let lldTotal = { hon_ht: 0, hon_tva: 0, hon_ttc: 0, reversement: 0 }
  {
    const { data: lldFacts } = await supabase
      .from('facture_evoliz')
      .select('id, bien_id, proprietaire_id, total_ht, total_tva, total_ttc, montant_reversement, statut, bien:bien_id(code, hospitable_name), proprietaire:proprietaire_id(nom, prenom)')
      .eq('mois', mois)
      .eq('agence', AGENCE)
      .eq('type_facture', 'lld')
      .eq('bloque_treso', false) // exclut les factures bloquées (loyer non encaissé) — pas du CA réel
    for (const f of (lldFacts || [])) {
      lldTotal.hon_ht  += f.total_ht  || 0
      lldTotal.hon_tva += f.total_tva || 0
      lldTotal.hon_ttc += f.total_ttc || 0
      lldTotal.reversement += f.montant_reversement || 0
      const pNom = f.proprietaire ? `${f.proprietaire.nom}${f.proprietaire.prenom ? ' ' + f.proprietaire.prenom : ''}` : null
      rows.push({
        bien_id: f.bien_id, bien_code: f.bien?.code || null, bien_nom: f.bien?.hospitable_name || null,
        proprietaire_id: f.proprietaire_id, proprietaire_nom: pNom,
        is_lld: true,
        nb_resas: 0, nb_rapprochees: 0, nb_non_rapprochees: 0, nb_non_ventilees: 0,
        hon_ht: f.total_ht || 0, hon_tva: f.total_tva || 0, hon_ttc: f.total_ttc || 0,
        fmen_ht: 0, fmen_tva: 0, fmen_ttc: 0,
        auto_ht: 0, loy_ht: 0, taxe_ht: 0, com_ht: 0, com_tva: 0, com_ttc: 0,
        frais_loy: 0, frais_direct: 0, prest_deduct: 0, debours_prop: 0,
        owner_stay_absorb: 0, auto_absorbable: 0, remboursements: 0,
        reversement_calcule: f.montant_reversement || 0, groupe_facturation: null,
        facture_id: f.id, facture_statut: f.statut, facture_montant_reversement: f.montant_reversement ?? null,
        ecart_reversement_proprio: null, reversement_fait_at: null,
        alert_count: 0, alert_level: null, alert_codes: [], alerts: [],
      })
    }
  }

  return {
    mois,
    rows,
    totals,
    alerts,
    fraisStripe,
    lauianFmenTotal,
    lldTotal,
    metadata: {
      generated_at:       new Date().toISOString(),
      nb_biens:           biens.length,
      nb_rows:            rows.length,
      has_blocking_errors: alerts.some(a => a.level === 'error'),
    },
  }
}

/**
 * exportComptaCSV(data)
 * Transforme le résultat de buildComptaMensuelle en CSV téléchargeable.
 * Aucune logique métier — consomme directement les rows.
 */
export function exportComptaCSV(data, bienActif = {}) {
  const isActif = (id) => bienActif[id] !== false
  const fmt = (c) => c != null ? (c / 100).toFixed(2) : '0.00'
  const masked = (val, actif) => actif ? val : ''
  const headers = [
    'Bien code', 'Bien nom', 'Propriétaire',
    'Nb réservations', 'Rapprochées', 'Non rapprochées', 'Non ventilées',
    'HON HT', 'HON TVA', 'HON TTC',
    'FMEN HT', 'FMEN TVA', 'FMEN TTC',
    'AUTO HT', 'Prest. déduit', 'Total AUTO HT', 'LOY HT', 'Frais HA proprio.', 'TAXE HT', 'Réversement calculé', 'Virement fait',
    'Statut facture', 'Réversement facturé', 'Écart facture', 'Alertes',
  ]
  // Regrouper les biens par groupe_facturation pour le CSV
  const GROUPE_LABELS = { MAITE: 'Maison Maïté' }
  const groupsMap = {}
  const csvRows = []
  const seenGroups = new Set()
  for (const r of data.rows) {
    if (r.groupe_facturation) {
      if (!groupsMap[r.groupe_facturation]) groupsMap[r.groupe_facturation] = []
      groupsMap[r.groupe_facturation].push(r)
    }
  }
  for (const r of data.rows) {
    if (r.groupe_facturation) {
      const gk = r.groupe_facturation
      if (!seenGroups.has(gk)) {
        seenGroups.add(gk)
        const children = groupsMap[gk]
        const nsum = key => children.reduce((s, c) => s + (c[key] || 0), 0)
        const first = children[0]
        const glabel = GROUPE_LABELS[gk] || gk
        // Réversement facturé : dédupliquer par facture_id (les biens d'un groupe partagent
        // souvent la même facture globale proprio — sommer naïvement multiplierait le montant)
        const facturesTotaux = new Map()
        for (const c of children) {
          if (c.facture_id != null && !facturesTotaux.has(c.facture_id))
            facturesTotaux.set(c.facture_id, c.facture_montant_reversement || 0)
        }
        const reversementFactureGroupe = [...facturesTotaux.values()].reduce((s, v) => s + v, 0)
        // Virement fait : premier enfant avec reversement_fait_at (groupe = 1 virement partagé)
        const faitAtGroupe = children.map(c => c.reversement_fait_at).find(v => v != null) ?? null
        const faitStrGroupe = faitAtGroupe ? (() => { const d = new Date(faitAtGroupe); return `OUI — ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}h` })() : ''
        // Ligne parent agrégée
        const groupeActif = children.some(c => isActif(c.bien_id))
        const actifChildren = children.filter(c => isActif(c.bien_id))
        const nsumA = key => actifChildren.reduce((s, c) => s + (c[key] || 0), 0)
        csvRows.push([
          glabel,
          '(groupe)',
          first.proprietaire_nom,
          masked(nsumA('nb_resas'), groupeActif), masked(nsumA('nb_rapprochees'), groupeActif), masked(nsumA('nb_non_rapprochees'), groupeActif), masked(nsumA('nb_non_ventilees'), groupeActif),
          masked(fmt(nsumA('hon_ht')), groupeActif), masked(fmt(nsumA('hon_tva')), groupeActif), masked(fmt(nsumA('hon_ttc')), groupeActif),
          masked(fmt(nsumA('fmen_ht')), groupeActif), masked(fmt(nsumA('fmen_tva')), groupeActif), masked(fmt(nsumA('fmen_ttc')), groupeActif),
          fmt(nsum('auto_ht')), masked(fmt(nsumA('prest_deduct')), groupeActif), fmt(nsum('auto_ht') + nsumA('prest_deduct')), masked(fmt(nsumA('loy_ht')), groupeActif), masked(fmt(nsumA('frais_loy')), groupeActif), masked(fmt(nsumA('taxe_ht')), groupeActif), masked(fmt(nsumA('reversement_calcule')), groupeActif), masked(faitStrGroupe, groupeActif),
          masked(first.facture_statut || '', groupeActif),
          masked(fmt(reversementFactureGroupe), groupeActif),
          masked(first.ecart_reversement_proprio != null ? fmt(first.ecart_reversement_proprio) : '', groupeActif),
          [...new Set(children.flatMap(c => c.alert_codes))].join(' | '),
        ])
      }
      // Ligne enfant indentée
      const enfantActif = isActif(r.bien_id)
      const faitEnfant = r.reversement_fait_at ? (() => { const d = new Date(r.reversement_fait_at); return `OUI — ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}h` })() : ''
      csvRows.push([
        '  ' + (r.bien_code || ''),
        '  ' + (r.bien_nom || ''),
        r.proprietaire_nom,
        masked(r.nb_resas, enfantActif), masked(r.nb_rapprochees, enfantActif), masked(r.nb_non_rapprochees, enfantActif), masked(r.nb_non_ventilees, enfantActif),
        masked(fmt(r.hon_ht), enfantActif), masked(fmt(r.hon_tva), enfantActif), masked(fmt(r.hon_ttc), enfantActif),
        masked(fmt(r.fmen_ht), enfantActif), masked(fmt(r.fmen_tva), enfantActif), masked(fmt(r.fmen_ttc), enfantActif),
        fmt(r.auto_ht), masked(fmt(r.prest_deduct), enfantActif), fmt((r.auto_ht || 0) + (r.prest_deduct || 0)), masked(fmt(r.loy_ht), enfantActif), masked(fmt(r.frais_loy), enfantActif), masked(fmt(r.taxe_ht), enfantActif), masked(fmt(r.reversement_calcule), enfantActif), masked(faitEnfant, enfantActif),
        '', '', '', r.alert_codes.join(' | '),
      ])
    } else {
      const rowActif = isActif(r.bien_id)
      const faitStr = r.reversement_fait_at ? (() => { const d = new Date(r.reversement_fait_at); return `OUI — ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}h` })() : ''
      csvRows.push([
        r.is_lauian_client ? `${r.bien_code} [FMEN Lauian]` : r.is_lld ? `${r.bien_code} [LLD]` : r.bien_code,
        r.is_lauian_client ? `${r.bien_nom || ''} (client Lauian)` : r.is_lld ? `${r.bien_nom || ''} (LLD)` : r.bien_nom,
        r.proprietaire_nom,
        masked(r.nb_resas, rowActif), masked(r.nb_rapprochees, rowActif), masked(r.nb_non_rapprochees, rowActif), masked(r.nb_non_ventilees, rowActif),
        masked(fmt(r.hon_ht), rowActif), masked(fmt(r.hon_tva), rowActif), masked(fmt(r.hon_ttc), rowActif),
        masked(fmt(r.fmen_ht), rowActif), masked(fmt(r.fmen_tva), rowActif), masked(fmt(r.fmen_ttc), rowActif),
        fmt(r.auto_ht), masked(fmt(r.prest_deduct), rowActif), fmt((r.auto_ht || 0) + (r.prest_deduct || 0)), masked(fmt(r.loy_ht), rowActif), masked(fmt(r.frais_loy), rowActif), masked(fmt(r.taxe_ht), rowActif), masked(fmt(r.reversement_calcule), rowActif), masked(faitStr, rowActif),
        masked(r.facture_statut || '', rowActif),
        masked(fmt(r.facture_montant_reversement), rowActif),
        masked(r.ecart_reversement_proprio != null ? fmt(r.ecart_reversement_proprio) : '', rowActif),
        r.alert_codes.join(' | '),
      ])
    }
  }
  const rows = csvRows
  // Lignes totaux (3 lignes : DCB / FMEN Lauian / Global)
  const actifRows    = data.rows.filter(r => isActif(r.bien_id))
  const actifDCB     = actifRows.filter(r => !r.is_lauian_client && !r.is_lld)
  const actifLau     = actifRows.filter(r =>  r.is_lauian_client)
  const actifLld     = actifRows.filter(r =>  r.is_lld)
  const asum  = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0)

  // Total DCB
  rows.push([
    'TOTAL DCB', '', '',
    asum(actifDCB, 'nb_resas'), asum(actifDCB, 'nb_rapprochees'), asum(actifDCB, 'nb_non_rapprochees'), asum(actifDCB, 'nb_non_ventilees'),
    fmt(asum(actifDCB, 'hon_ht')), fmt(asum(actifDCB, 'hon_tva')), fmt(asum(actifDCB, 'hon_ttc')),
    fmt(asum(actifDCB, 'fmen_ht')), fmt(asum(actifDCB, 'fmen_tva')), fmt(asum(actifDCB, 'fmen_ttc')),
    fmt(asum(actifDCB, 'auto_ht')), fmt(asum(actifDCB, 'prest_deduct')), fmt(asum(actifDCB, 'auto_ht') + asum(actifDCB, 'prest_deduct')),
    fmt(asum(actifDCB, 'loy_ht')), fmt(asum(actifDCB, 'frais_loy')), fmt(asum(actifDCB, 'taxe_ht')), fmt(asum(actifDCB, 'reversement_calcule')), '',
    '', '', '', '',
  ])
  // Total Honoraires LLD (uniquement si des lignes LLD existent)
  if (actifLld.length > 0) {
    rows.push([
      'TOTAL LLD', '', '',
      '', '', '', '',
      fmt(asum(actifLld, 'hon_ht')), fmt(asum(actifLld, 'hon_tva')), fmt(asum(actifLld, 'hon_ttc')),
      '', '', '',
      '', '', '', '', '', '', fmt(asum(actifLld, 'reversement_calcule')), '',
      '', '', '', '',
    ])
  }
  // Total FMEN Lauian (uniquement si des lignes Lauian existent)
  if (actifLau.length > 0) {
    rows.push([
      'TOTAL FMEN Lauian', '', '',
      '', '', '', '',
      '', '', '',
      fmt(asum(actifLau, 'fmen_ht')), fmt(asum(actifLau, 'fmen_tva')), fmt(asum(actifLau, 'fmen_ttc')),
      '', '', '', '', '', '', '', '',
      '', '', '', '',
    ])
  }
  // Total Global (dès qu'il y a du Lauian ou du LLD en plus du DCB)
  if (actifLau.length > 0 || actifLld.length > 0) {
    rows.push([
      'TOTAL GLOBAL', '', '',
      asum(actifRows, 'nb_resas'), asum(actifRows, 'nb_rapprochees'), asum(actifRows, 'nb_non_rapprochees'), asum(actifRows, 'nb_non_ventilees'),
      fmt(asum(actifRows, 'hon_ht')), fmt(asum(actifRows, 'hon_tva')), fmt(asum(actifRows, 'hon_ttc')),
      fmt(asum(actifRows, 'fmen_ht')), fmt(asum(actifRows, 'fmen_tva')), fmt(asum(actifRows, 'fmen_ttc')),
      fmt(asum(actifRows, 'auto_ht')), fmt(asum(actifRows, 'prest_deduct')), fmt(asum(actifRows, 'auto_ht') + asum(actifRows, 'prest_deduct')),
      fmt(asum(actifRows, 'loy_ht')), fmt(asum(actifRows, 'frais_loy')), fmt(asum(actifRows, 'taxe_ht')), fmt(asum(actifRows, 'reversement_calcule')), '',
      '', '', '', '',
    ])
  }

  let csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')

  // Section frais Stripe en pied de fichier
  if (data.fraisStripe) {
    const fmtE = (c) => (c / 100).toFixed(2) + ' €'
    csv += '\n'
    csv += `\n"--- FRAIS STRIPE ---","${fmtE(data.fraisStripe.total)}","À virer compte courant → compte de gestion"`
    for (const p of Object.values(data.fraisStripe.parPayout)) {
      csv += `\n"Virement ${p.date}","${fmtE(p.credit)}","frais: ${fmtE(p.frais)}"`
    }
  }

  return '\uFEFF' + csv
}

export function downloadComptaCSV(data) {
  const csv = exportComptaCSV(data)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `DCB_Comptabilite_${data.mois}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
