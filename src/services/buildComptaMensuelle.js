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
import { STATUTS_NON_VENTILABLES } from '../lib/constants'

export async function buildComptaMensuelle(mois) {
  // ── Phase 1 : chargement parallèle ──────────────────────────────────────
  const [
    { data: biensData,   error: biensErr  },
    { data: resasData,   error: resasErr  },
    { data: ventilData,  error: ventilErr },
    { data: facturesHon, error: honErr    },
    { data: facturesDeb, error: debErr    },
    { data: fraisData,   error: fraisErr  },
  ] = await Promise.all([
    supabase
      .from('bien')
      .select('id, code, hospitable_name, listed, proprietaire_id, proprietaire:proprietaire_id(id, nom, prenom)')
      .eq('agence', 'dcb'),
    supabase
      .from('reservation')
      .select('id, bien_id, final_status, ventilation_calculee, rapprochee, owner_stay, fin_revenue')
      .eq('mois_comptable', mois),
    supabase
      .from('ventilation')
      .select('bien_id, code, montant_ht, montant_tva, montant_ttc')
      .eq('mois_comptable', mois)
      .in('code', ['HON', 'FMEN', 'AUTO', 'LOY', 'VIR', 'TAXE', 'COM']),
    supabase
      .from('facture_evoliz')
      .select('id, proprietaire_id, statut, total_ht, total_ttc, montant_reversement')
      .eq('mois', mois)
      .eq('type_facture', 'honoraires'),
    supabase
      .from('facture_evoliz')
      .select('id, proprietaire_id, statut, total_ht, total_ttc')
      .eq('mois', mois)
      .eq('type_facture', 'debours'),
    supabase
      .from('frais_proprietaire')
      .select('bien_id, statut, statut_deduction, mode_traitement, montant_ttc, montant_deduit_loy')
      .eq('mois_compta', mois)
      .eq('mode_traitement', 'deduire_loyer'),
  ])

  if (biensErr)  throw new Error(`buildComptaMensuelle — biens: ${biensErr.message}`)
  if (resasErr)  throw new Error(`buildComptaMensuelle — resas: ${resasErr.message}`)
  if (ventilErr) throw new Error(`buildComptaMensuelle — ventilation: ${ventilErr.message}`)
  if (honErr)    throw new Error(`buildComptaMensuelle — factures honoraires: ${honErr.message}`)
  if (debErr)    throw new Error(`buildComptaMensuelle — factures débours: ${debErr.message}`)
  // fraisErr non bloquant — on continue sans les frais si la requête échoue

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
  const ventilAgg = {}
  for (const v of ventils) {
    const key = `${v.bien_id}::${v.code}`
    if (!ventilAgg[key]) ventilAgg[key] = { ht: 0, tva: 0, ttc: 0 }
    ventilAgg[key].ht  += (v.montant_ht  || 0)
    ventilAgg[key].tva += (v.montant_tva || 0)
    ventilAgg[key].ttc += (v.montant_ttc || 0)
  }
  const vent = (bienId, code) => ventilAgg[`${bienId}::${code}`] || { ht: 0, tva: 0, ttc: 0 }

  // Factures honoraires par proprietaire_id
  const honByProprio = {}
  for (const f of honFacts) honByProprio[f.proprietaire_id] = f

  // Frais déduits du loyer, agrégés par bien_id (même formule que rapportStatement)
  const fraisLoyByBien = {}
  for (const f of (fraisData || [])) {
    let montant = 0
    if (f.statut === 'facture' && f.statut_deduction !== 'en_attente') montant = f.montant_deduit_loy || 0
    else if (f.statut === 'facture' && f.statut_deduction === 'en_attente') montant = f.montant_ttc || 0
    else if (f.statut === 'a_facturer') montant = f.montant_ttc || 0
    fraisLoyByBien[f.bien_id] = (fraisLoyByBien[f.bien_id] || 0) + montant
  }

  // Biens actifs ce mois (au moins une resa ou de la ventilation)
  const biensAvecResas   = new Set(resas.map(r => r.bien_id))
  const biensAvecVentil  = new Set(ventils.map(v => v.bien_id))
  const biensActifs = biens.filter(b => biensAvecResas.has(b.id) || biensAvecVentil.has(b.id))

  // ── Phase 3 : Σ (loy_ht − frais_déduction_loyer) par propriétaire ───────────
  // Même logique que rapportStatement pour montant_reversement → pas de faux écart
  const loyParProprio = {}
  for (const b of biensActifs) {
    if (!b.proprietaire_id) continue
    const loyNet = vent(b.id, 'LOY').ht - (fraisLoyByBien[b.id] || 0)
    loyParProprio[b.proprietaire_id] = (loyParProprio[b.proprietaire_id] || 0) + loyNet
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
    const auto = vent(b.id, 'AUTO')
    const loy  = vent(b.id, 'LOY')
    const vir  = vent(b.id, 'VIR')
    const taxe = vent(b.id, 'TAXE')
    const com  = vent(b.id, 'COM')

    // Facture du proprio
    const facture = propId ? honByProprio[propId] : null

    // Reversement calculé par bien : VIR est la base (LOY + taxes non-remittées)
    // frais déductibles du loyer viennent en déduction
    const frais_loy = fraisLoyByBien[b.id] || 0
    const reversement_calcule = vir.ht - frais_loy

    // Écart : VIR - (VIR - frais) = frais → devrait être 0 quand frais=0
    // Colonne masquée par défaut, utile uniquement pour détecter des incohérences
    const ecart_vir_loy = (vir.ht > 0) ? vir.ht - reversement_calcule : null

    // Écart reversement au niveau proprio : facture Evoliz vs Σ reversement_calcule
    let ecart_reversement_proprio = null
    if (propId && facture && facture.montant_reversement != null) {
      ecart_reversement_proprio = facture.montant_reversement - (loyParProprio[propId] || 0)
    }

    // Alertes de la ligne
    const rowAlerts = []

    if (nb_non_ventilees > 0)
      rowAlerts.push({ level: 'warning', code: 'NON_VENTILEES', message: `${nb_non_ventilees} résa(s) non ventilée(s)`, bien_id: b.id })

    if (hon.ttc > 0 && !facture)
      rowAlerts.push({ level: 'error', code: 'NO_FACTURE', message: `HON ${(hon.ttc/100).toFixed(2)} € sans facture`, bien_id: b.id })

    if (ecart_reversement_proprio != null && Math.abs(ecart_reversement_proprio) > 100)
      rowAlerts.push({ level: 'warning', code: 'ECART_REVERSEMENT', message: `Écart reversement : ${(ecart_reversement_proprio/100).toFixed(2)} €`, bien_id: b.id })

    if (nb_non_rapprochees > 0)
      rowAlerts.push({ level: 'warning', code: 'VIR_SANS_RAPPROCHEMENT', message: `${nb_non_rapprochees} virement(s) non rapproché(s)`, bien_id: b.id })

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
      vir_ht:   vir.ht,
      taxe_ht:  taxe.ht,
      com_ht:   com.ht,
      com_tva:  com.tva,
      com_ttc:  com.ttc,

      frais_loy,
      reversement_calcule,
      ecart_vir_loy,

      facture_id:                  facture?.id                  ?? null,
      facture_statut:              facture?.statut              ?? null,
      facture_montant_reversement: facture?.montant_reversement ?? null,
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
    vir_ht:   rows.reduce((s, r) => s + r.vir_ht,   0),
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
      const dedupeKey = ['NO_FACTURE', 'ECART_REVERSEMENT'].includes(a.code)
        ? `${a.code}::${row.proprietaire_id}`
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

  return {
    mois,
    rows,
    totals,
    alerts,
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
    'Nb resas', 'Rapprochées', 'Non rapprochées', 'Non ventilées',
    'HON HT', 'HON TVA', 'HON TTC',
    'FMEN HT', 'FMEN TVA', 'FMEN TTC',
    'AUTO HT', 'LOY HT', 'Frais LOY', 'Reversement calculé', 'VIR HT', 'Écart VIR/LOY', 'TAXE HT',
    'Facture statut', 'Reversement facturé', 'Écart facture', 'Alertes',
  ]
  const rows = data.rows.map(r => [
    r.bien_code,
    r.bien_nom,
    r.proprietaire_nom,
    r.nb_resas,
    r.nb_rapprochees,
    r.nb_non_rapprochees,
    r.nb_non_ventilees,
    fmt(r.hon_ht), fmt(r.hon_tva), fmt(r.hon_ttc),
    fmt(r.fmen_ht), fmt(r.fmen_tva), fmt(r.fmen_ttc),
    fmt(r.auto_ht), fmt(r.loy_ht), fmt(r.frais_loy), fmt(r.reversement_calcule), fmt(r.vir_ht),
    r.ecart_vir_loy != null ? fmt(r.ecart_vir_loy) : '',
    fmt(r.taxe_ht),
    r.facture_statut || '',
    fmt(r.facture_montant_reversement),
    r.ecart_reversement_proprio != null ? fmt(r.ecart_reversement_proprio) : '',
    r.alert_codes.join(' | '),
  ])
  // Ligne totaux
  const t = data.totals
  rows.push([
    'TOTAL', '', '',
    t.nb_resas, t.nb_rapprochees, t.nb_non_rapprochees, t.nb_non_ventilees,
    fmt(t.hon_ht), fmt(t.hon_tva), fmt(t.hon_ttc),
    fmt(t.fmen_ht), fmt(t.fmen_tva), fmt(t.fmen_ttc),
    fmt(t.auto_ht), fmt(t.loy_ht), fmt(t.vir_ht), fmt(t.taxe_ht),
    '', '', '', '',
  ])

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `comptabilite-${data.mois}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
