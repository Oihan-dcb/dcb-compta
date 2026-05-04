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

export async function buildComptaMensuelle(mois) {
  // ── Phase 1 : chargement parallèle ──────────────────────────────────────
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
  ] = await Promise.all([
    supabase
      .from('bien')
      .select('id, code, hospitable_name, listed, proprietaire_id, groupe_facturation, proprietaire:proprietaire_id(id, nom, prenom)')
      .eq('agence', AGENCE),
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
      .eq('mode_traitement', 'deduire_loyer'),
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
      .select('bien_id, montant, ae:ae_id(type)')
      .eq('mois', mois)
      .eq('type_imputation', 'deduction_loy')
      .eq('statut', 'valide'),
    // prestations débours proprio absorbés
    supabase
      .from('prestation_hors_forfait')
      .select('bien_id, montant')
      .eq('mois', mois)
      .eq('type_imputation', 'debours_proprio')
      .eq('statut', 'valide'),
  ])

  if (biensErr)  throw new Error(`buildComptaMensuelle — biens: ${biensErr.message}`)
  if (resasErr)  throw new Error(`buildComptaMensuelle — resas: ${resasErr.message}`)
  if (ventilErr) throw new Error(`buildComptaMensuelle — ventilation: ${ventilErr.message}`)
  if (honErr)    throw new Error(`buildComptaMensuelle — factures honoraires: ${honErr.message}`)
  if (debErr)    throw new Error(`buildComptaMensuelle — factures débours: ${debErr.message}`)
  // frais/prestations non bloquants — on continue sans si la requête échoue

  const biens    = biensData    || []
  const resas    = resasData    || []
  const ventils  = ventilData   || []
  const honFacts = facturesHon  || []

  // ── Phase 2 : indexation ─────────────────────────────────────────────────

  // Réservations par bien_id
  const resasByBien = {}
  for (const r of resas) {
    if (!resasByBien[r.bien_id]) resasByBien[r.bien_id] = []
    resasByBien[r.bien_id].push(r)
  }

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
    const isStaff = p.ae?.type === 'staff'
    const montant = isStaff ? Math.round((p.montant || 0) * 1.20) : (p.montant || 0)
    prestDeductByBien[p.bien_id] = (prestDeductByBien[p.bien_id] || 0) + montant
  }

  // Prestations débours proprio absorbés par bien_id
  const deboursPropByBien = {}
  for (const p of (prestDeboursData || [])) {
    deboursPropByBien[p.bien_id] = (deboursPropByBien[p.bien_id] || 0) + (p.montant || 0)
  }

  // Owner stay : FMEN TTC + AUTO HT par bien (depuis ventilation, réservations owner_stay)
  // Identique à facturesEvoliz.js — absorbés par LOY résiduel, réduit le reversement
  const osResaIds = new Set(resas.filter(r => r.owner_stay).map(r => r.id))
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

  // Biens actifs ce mois (au moins une resa ou de la ventilation)
  const biensAvecResas   = new Set(resas.map(r => r.bien_id))
  const biensAvecVentil  = new Set(ventils.map(v => v.bien_id))
  const biensActifs = biens.filter(b => biensAvecResas.has(b.id) || biensAvecVentil.has(b.id))

  // ── Phase 3 : ownerStayAbsorbByBien + Σ reversement_calcule par proprio ────
  // Formule alignée sur facturesEvoliz.js :
  // reversement = max(0, VIR - fraisLoy - fraisDirect - prestDeduct - haowner - deboursProp - ownerStayAbsorb) + remboursements
  const loyParProprio = {}
  const ownerStayAbsorbByBien = {}
  const composantesParProprio = {}
  for (const b of biensActifs) {
    // LOY résiduel après toutes les déductions standard (ordre = facturesEvoliz)
    const loyHt      = vent(b.id, 'LOY').ht
    const autoHt     = vent(b.id, 'AUTO').ht
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
    const virNet = Math.max(0, virHt2 - fraisLoy - fraisDirect - prestDeduct - deboursProp - ownerStayAbsorbByBien[b.id] - autoAbsorbable) + rembours
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
      (!STATUTS_NON_VENTILABLES.includes(r.final_status) || (r.fin_revenue || 0) > 0)
    )
    const nb_resas            = resasGuest.length
    const nb_rapprochees      = resasGuest.filter(r =>  r.rapprochee).length
    const nb_non_rapprochees  = resasGuest.filter(r => !r.rapprochee).length
    const nb_non_ventilees    = resasGuest.filter(r => !r.ventilation_calculee).length

    // Ventilation
    const hon  = vent(b.id, 'HON')
    const fmen = vent(b.id, 'FMEN')
    const men  = vent(b.id, 'MEN')
    const auto = vent(b.id, 'AUTO')
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
    // reversement = max(0, VIR − déductions) + remboursements
    // Aligné sur facturesEvoliz.js — VIR est la base (inclut taxes passthrough le cas échéant)
    const reversement_calcule = Math.max(0, vir.ht - frais_loy - frais_direct - prest_deduct - debours_prop - owner_stay_absorb - auto_absorbable) + remboursements

    // Écart reversement au niveau proprio : Σ factures vs Σ reversement_calcule tous biens
    let ecart_reversement_proprio = null
    if (propId && reversementFactureParProprio[propId] != null) {
      ecart_reversement_proprio = reversementFactureParProprio[propId] - (loyParProprio[propId] || 0)
    }

    // Alertes de la ligne
    const rowAlerts = []

    if (nb_non_ventilees > 0)
      rowAlerts.push({ level: 'warning', code: 'NON_VENTILEES', message: `${nb_non_ventilees} résa(s) non ventilée(s)`, bien_id: b.id })

    if (hon.ttc > 0 && !facture)
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
      bien_id:          b.id,
      bien_code:        b.code         || null,
      bien_nom:         b.hospitable_name || null,
      proprietaire_id:  propId         || null,
      proprietaire_nom: propNom        || null,

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

  return {
    mois,
    rows,
    totals,
    alerts,
    fraisStripe,
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
export function exportComptaCSV(data) {
  const fmt = (c) => c != null ? (c / 100).toFixed(2) : '0.00'
  const headers = [
    'Bien code', 'Bien nom', 'Propriétaire',
    'Nb réservations', 'Rapprochées', 'Non rapprochées', 'Non ventilées',
    'HON HT', 'HON TVA', 'HON TTC',
    'FMEN HT', 'FMEN TVA', 'FMEN TTC',
    'AUTO HT', 'LOY HT', 'Frais HA proprio.', 'Réversement calculé', 'TAXE HT',
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
        // Ligne parent agrégée
        csvRows.push([
          glabel,
          '(groupe)',
          first.proprietaire_nom,
          nsum('nb_resas'), nsum('nb_rapprochees'), nsum('nb_non_rapprochees'), nsum('nb_non_ventilees'),
          fmt(nsum('hon_ht')), fmt(nsum('hon_tva')), fmt(nsum('hon_ttc')),
          fmt(nsum('fmen_ht')), fmt(nsum('fmen_tva')), fmt(nsum('fmen_ttc')),
          fmt(nsum('auto_ht')), fmt(nsum('loy_ht')), fmt(nsum('frais_loy')), fmt(nsum('reversement_calcule')), fmt(nsum('taxe_ht')),
          first.facture_statut || '',
          fmt(nsum('facture_montant_reversement')),
          first.ecart_reversement_proprio != null ? fmt(first.ecart_reversement_proprio) : '',
          [...new Set(children.flatMap(c => c.alert_codes))].join(' | '),
        ])
      }
      // Ligne enfant indentée
      csvRows.push([
        '  ' + (r.bien_code || ''),
        '  ' + (r.bien_nom || ''),
        r.proprietaire_nom,
        r.nb_resas, r.nb_rapprochees, r.nb_non_rapprochees, r.nb_non_ventilees,
        fmt(r.hon_ht), fmt(r.hon_tva), fmt(r.hon_ttc),
        fmt(r.fmen_ht), fmt(r.fmen_tva), fmt(r.fmen_ttc),
        fmt(r.auto_ht), fmt(r.loy_ht), fmt(r.frais_loy), fmt(r.reversement_calcule), fmt(r.taxe_ht),
        '', '', '', r.alert_codes.join(' | '),
      ])
    } else {
      csvRows.push([
        r.bien_code, r.bien_nom, r.proprietaire_nom,
        r.nb_resas, r.nb_rapprochees, r.nb_non_rapprochees, r.nb_non_ventilees,
        fmt(r.hon_ht), fmt(r.hon_tva), fmt(r.hon_ttc),
        fmt(r.fmen_ht), fmt(r.fmen_tva), fmt(r.fmen_ttc),
        fmt(r.auto_ht), fmt(r.loy_ht), fmt(r.frais_loy), fmt(r.reversement_calcule), fmt(r.taxe_ht),
        r.facture_statut || '',
        fmt(r.facture_montant_reversement),
        r.ecart_reversement_proprio != null ? fmt(r.ecart_reversement_proprio) : '',
        r.alert_codes.join(' | '),
      ])
    }
  }
  const rows = csvRows
  // Ligne totaux
  const t = data.totals
  rows.push([
    'TOTAL', '', '',
    t.nb_resas, t.nb_rapprochees, t.nb_non_rapprochees, t.nb_non_ventilees,
    fmt(t.hon_ht), fmt(t.hon_tva), fmt(t.hon_ttc),
    fmt(t.fmen_ht), fmt(t.fmen_tva), fmt(t.fmen_ttc),
    fmt(t.auto_ht), fmt(t.loy_ht), fmt(t.taxe_ht),
    '', '', '', '',
  ])

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
