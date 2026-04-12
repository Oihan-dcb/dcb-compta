/**
 * src/services/exportCSVComptable.js
 * Export CSV rapprochement comptable v2 — audit-friendly
 *
 * 10 blocs (A→J) + contrôles automatiques de cohérence
 * Backward-compatible : toutes les colonnes v1 conservées telles quelles.
 *
 * Usage : const csv = await exportCSVComptable(mouvements, mois)
 *   mouvements : tableau enrichi retourné par getMouvementsMois()
 *   mois       : 'YYYY-MM'
 */
import { supabase } from '../lib/supabase'

const CODES_V1  = ['HON', 'FMEN', 'AUTO', 'LOY', 'VIR', 'TAXE']
const CODES_NEW = ['HAOWNER', 'PREST', 'FRAIS', 'DEBP', 'DEB_AE']
const CODES_VENTIL = [...CODES_V1, ...CODES_NEW]   // 11 codes

// ── Helpers purs ─────────────────────────────────────────────────

/** YYYY-MM-DD ou '' */
function normalizeDate(d) {
  if (!d) return ''
  return String(d).slice(0, 10)
}

/** Centimes → "1234.56" (2 décimales, point décimal) — '' si null */
function normalizeAmount(cents) {
  if (cents == null) return ''
  return (Number(cents) / 100).toFixed(2)
}

/** YYYY-MM-DD → "DD/MM/YYYY" (compat v1) */
function formatDateFR(d) {
  const s = normalizeDate(d)
  if (!s) return ''
  const [y, m, day] = s.split('-')
  return day ? `${day}/${m}/${y}` : s
}

/**
 * Normalise final_status → enum stable (valeurs FR)
 * Source : reservation.final_status (text brut Hospitable)
 * Fallback : 'inconnu'
 */
function normalizeStatus(s) {
  if (!s) return 'inconnu'
  const l = s.toLowerCase().replace(/_/g, ' ')
  if (l === 'accepted' || l === 'confirmed') return 'confirmee'
  if (l === 'cancelled')                     return 'annulee'
  if (l === 'not accepted')                  return 'non_acceptee'
  if (l === 'declined')                      return 'refusee'
  if (l === 'expired')                       return 'expiree'
  return 'inconnu'
}

/** Sérialiseur CSV : guillemets doubles, échappe les guillemets internes */
function q(v) {
  if (v == null || v === '') return '""'
  return '"' + String(v).replace(/"/g, '""') + '"'
}

// ── Agrégation ventilation ────────────────────────────────────────

/**
 * Agrège les lignes ventilation pour un ensemble de reservation_ids.
 * Gère les VIR résiduels numérotés (multi-virement).
 * Source : ventilation.montant_reel IS NOT NULL → auto_est_reel = true
 */
function aggregateVent(resaIds, ventByResa) {
  const agg = {}
  for (const c of CODES_VENTIL) {
    agg[c] = { ht: 0, tva: 0, ttc: 0, has: false, reel: false }
  }
  let nbVirLies = 0
  for (const resaId of resaIds) {
    for (const v of (ventByResa[resaId] || [])) {
      const c = v.code
      if (!agg[c]) agg[c] = { ht: 0, tva: 0, ttc: 0, has: false, reel: false }
      agg[c].ht  += (v.montant_ht  || 0)
      agg[c].tva += (v.montant_tva || 0)
      agg[c].ttc += (v.montant_ttc || 0)
      agg[c].has  = true
      if (c === 'AUTO' && v.montant_reel != null) agg[c].reel = true
      if (c === 'VIR'  && v.mouvement_id != null) nbVirLies++
    }
  }
  return { agg, nbVirLies }
}

// ── Constructeurs de blocs ────────────────────────────────────────

/**
 * BLOC A — Identité technique
 * Source : mouvement.id, paramètre mois, timestamp export runtime
 * Règle : ligne_uuid généré localement (crypto.randomUUID)
 */
function buildBlocA(mouv, resaIds, codes, mois, exportedAt) {
  return {
    version_export:   'rapprochement_v2',
    date_export:      exportedAt,
    mois_comptable:   mois,
    uuid_ligne:       crypto.randomUUID(),
    id_mouvement:     mouv.id   || '',
    id_reservations:  resaIds.join(' | '),
    code_reservations: codes.join(' | '),
  }
}

/**
 * BLOC B — Bancaire
 * Colonnes existantes conservées (v1) + date_operation_iso, montant_signe_eur, sens_mouvement
 * Source : mouvement_bancaire.*
 * Règle : crédit → positif / débit → négatif dans montant_signe_eur
 */
function buildBlocB(mouv) {
  const credit = mouv.credit || 0
  const debit  = mouv.debit  || 0
  return {
    'Date opération':        formatDateFR(mouv.date_operation),
    'Libellé virement':      mouv.libelle    || '',
    'Référence':              mouv.reference  || '',
    'Entrée EUR':            credit > 0 ? normalizeAmount(credit) : '',
    'Sortie EUR':            debit  > 0 ? normalizeAmount(debit)  : '',
    Statut:                  mouv.statut_matching || '',
    canal_bancaire_detecte:  mouv.canal      || '',
    date_operation_iso:      normalizeDate(mouv.date_operation),
    montant_signe_eur:       normalizeAmount(credit > 0 ? credit : -debit),
    sens_mouvement:          credit > 0 ? 'entree' : debit > 0 ? 'sortie' : '',
  }
}

/**
 * BLOC C — Réservation
 * Colonnes existantes (v1) + flags qualificatifs
 * Source : m._resa (agrégé) | p.reservation (per-resa Stripe/Booking)
 * Source resaDetails[0] : reservation.owner_stay, hospitable_id, final_status
 * Fallback : '' si donnée absente — jamais d'erreur bloquante
 */
function buildBlocC(mouv, resa, resaIds, codes, resaDetails, payoutByMouv) {
  const first      = resaDetails[0] || {}
  const statusNorm = normalizeStatus(first.final_status)
  const platform   = resa?.platform || first.platform || ''
  const nbResas    = resaIds.length

  return {
    'Bien(s)':                    resa?.biens?.join(' | ') || resa?.bien_name || first?.bien?.hospitable_name || '',
    'Voyageur(s)':                resa?.guests?.join(' | ') || resa?.guest_name || '',
    Plateforme:                   platform,
    'Arrivée':                    formatDateFR(resa?.arrival_date  || first.arrival_date),
    'Départ':                     formatDateFR(resa?.departure_date || first.departure_date),
    Nuits:                        resa?.nights ?? first.nights ?? '',
    'Code résa':                  codes.join(' | '),
    statut_resa_normalise:        statusNorm,
    sejour_proprietaire:          first.owner_stay           ?? false,
    annulee:                      statusNorm === 'annulee',
    import_manuel:                platform   === 'manual',
    reservation_directe:          platform   === 'direct',
    payout_groupe:                nbResas    >  1,
    nb_reservations_liees:        nbResas,
    codes_resas_lies:             codes.join(' | '),
    hospitable_id:                first.hospitable_id        || '',
    payout_id:                    payoutByMouv[mouv.id]      || '',
  }
}

/**
 * BLOC D — Commercial
 * Source : bien + proprietaire via resaDetails[0].bien.*
 * Règle : bien.mode_encaissement 'dcb'|'proprio' → nature du flux AUTO
 */
function buildBlocD(resaDetails) {
  const bien = resaDetails[0]?.bien  || {}
  const prop = bien.proprietaire      || {}
  return {
    agence:            bien.agence            || '',
    bien_id:           bien.id               || '',
    proprietaire_id:   bien.proprietaire_id   || '',
    proprietaire_nom:  prop.nom              || '',
    mode_encaissement: bien.mode_encaissement || '',
    gestion_loyer:     bien.gestion_loyer    ?? '',
    compte_airbnb:     bien.compte_airbnb    || '',
  }
}

/**
 * BLOC E — Montants résa
 * revenu_net_eur : fin_revenue de la(des) résa(s) — source de vérité ventilation
 * acompte_eur    : crédit bancaire de cette ligne (peut être partiel)
 * solde_eur      : revenu_net - acompte
 * pct_du_total   : numérique pur ex: 75.50 (pas de %, pas d'espace)
 */
function buildBlocE(finRevenue, montantAcompte) {
  const rev     = finRevenue     || 0
  const acompte = montantAcompte || 0
  const solde   = rev - acompte
  const pct     = (rev > 0 && acompte > 0) ? (acompte / rev * 100).toFixed(2) : ''
  return {
    'Revenu net EUR': normalizeAmount(rev),
    'Acompte EUR':    acompte > 0 ? normalizeAmount(acompte) : '',
    solde_eur:        normalizeAmount(solde),
    pct_du_total:     pct,
  }
}

/**
 * BLOC F — Ventilation comptable
 * 11 codes × HT/TVA/TTC + auto_est_reel + totaux + écarts
 * Règle : '' = code absent (non ventilé), "0.00" = calculé à zéro
 * auto_est_reel : ventilation.montant_reel IS NOT NULL → AUTO réel saisi manuellement en portail AE
 */
function buildBlocF(agg, totalHt, totalTva, totalTtc, ecartVsRevenu, ecartVsBancaire) {
  const cols = {}
  for (const c of CODES_VENTIL) {
    const v = agg[c]
    cols[`${c} HT`]  = v.has ? normalizeAmount(v.ht)  : ''
    cols[`${c} TVA`] = v.has ? normalizeAmount(v.tva) : ''
    cols[`${c} TTC`] = v.has ? normalizeAmount(v.ttc) : ''
  }
  cols.auto_est_reel                   = agg['AUTO']?.reel ?? false
  cols.total_ventilation_ht            = normalizeAmount(totalHt)
  cols.total_ventilation_tva           = normalizeAmount(totalTva)
  cols.total_ventilation_ttc           = normalizeAmount(totalTtc)
  cols.ecart_vs_revenu_net_eur         = ecartVsRevenu
  cols.ecart_vs_mouvement_bancaire_eur = ecartVsBancaire
  return cols
}

/**
 * BLOC G — Qualification comptable
 * nature_flux    : déduite canal + sens + statut + resas liées
 * imputation_principale : code ventilation dominant
 */
function buildBlocG(mouv, resa, agg) {
  const canal  = mouv.canal || ''
  const credit = mouv.credit || 0
  const debit  = mouv.debit  || 0
  const statut = mouv.statut_matching

  // Nature flux
  let natureFlux = 'flux_non_gere'
  if (debit > 0) {
    if (canal === 'sortant_proprio')         natureFlux = 'reversement_proprietaire'
    else if (canal === 'sortant_ae')         natureFlux = 'debours_ae'
    else if (canal === 'sortant_honoraires') natureFlux = 'commission_dcb'
    else                                     natureFlux = 'remboursement'
  } else if (statut === 'non_identifie' || statut === 'non_gere') {
    natureFlux = 'flux_non_gere'
  } else if (canal === 'interne') {
    natureFlux = 'virement_interne'
  } else if (credit > 0 && (resa?.reservation_ids?.length || 0) > 0) {
    natureFlux = 'encaissement_client'
  }

  // Imputation principale
  const honTtc  = agg['HON']?.ttc  || 0
  const fmenTtc = agg['FMEN']?.ttc || 0
  const autoTtc = agg['AUTO']?.ttc || 0
  const loyHt   = agg['LOY']?.ht   || 0
  const taxeTtc = agg['TAXE']?.ttc || 0
  const actifs  = [honTtc > 0, fmenTtc > 0, autoTtc > 0, loyHt > 0, taxeTtc > 0].filter(Boolean).length
  let imputation = 'inclassable'
  if (actifs > 2 || (honTtc > 0 && fmenTtc > 0)) imputation = 'mixte'
  else if (honTtc  > 0) imputation = 'honoraires'
  else if (fmenTtc > 0) imputation = 'menage'
  else if (autoTtc > 0) imputation = 'debours_ae'
  else if (loyHt   > 0) imputation = 'loyer_proprietaire'
  else if (taxeTtc > 0) imputation = 'taxe'

  return {
    part_dcb_eur:          normalizeAmount(honTtc + fmenTtc),
    part_proprietaire_eur: normalizeAmount(loyHt),
    part_taxe_eur:         normalizeAmount(taxeTtc),
    nature_flux:           natureFlux,
    imputation_principale: imputation,
  }
}

/**
 * BLOC H — Rapprochement
 * statut_rapprochement : version normalisée étendue de mouvement_bancaire.statut_matching
 *   rapproche_total    : solde ≤ 2,00 €
 *   rapproche_partiel  : solde > 2,00 € (multi-virement en cours)
 * motif_anomalie + niveau_anomalie : info / warning / critique
 * besoin_revue_humaine : true si niveau ≥ warning
 */
function buildBlocH(mouv, resaDetails, resa, finRevenue, montantAcompte, nbVirLies) {
  const statut = mouv.statut_matching
  const canal  = mouv.canal || ''
  const credit = mouv.credit || 0
  const finRev = finRevenue || 0
  const solde  = finRev - (montantAcompte || 0)
  const hasResa = resaDetails.length > 0 || (resa?.reservation_ids?.length || 0) > 0
  const firstSt = normalizeStatus(resaDetails[0]?.final_status)

  // statut_rapprochement
  let statutRapprochement = 'non_identifie'
  if (statut === 'rapproche' || statut === 'matche_auto' || statut === 'matche_manuel') {
    statutRapprochement = Math.abs(solde) <= 200 ? 'rapproche_total' : 'rapproche_partiel'
  } else if (statut === 'en_attente')  statutRapprochement = 'en_attente'
  else if (statut === 'non_gere')      statutRapprochement = 'non_gere'
  else if (firstSt === 'annulee')       statutRapprochement = 'annule'

  // rapprochement_mode
  let rapprochementMode = 'aucun'
  if (statut === 'rapproche' || statut === 'matche_auto') {
    if (canal === 'airbnb')                         rapprochementMode = 'automatique'
    else if (['booking', 'stripe'].includes(canal)) rapprochementMode = 'import_csv'
    else                                            rapprochementMode = 'manuel'
  } else if (statut === 'matche_manuel') {
    rapprochementMode = 'manuel'
  }

  const mouvOrphelin     = !hasResa && credit > 0 && statut !== 'non_gere'
  const resaSansVirement = hasResa && nbVirLies === 0 &&
    (statut === 'rapproche' || statut === 'matche_auto' || statut === 'matche_manuel')

  let motif  = ''
  let niveau = 'information'
  if (statut === 'non_identifie')                       { motif = 'mouvement_sans_reservation'; niveau = 'alerte'   }
  else if (statutRapprochement === 'rapproche_partiel') { motif = 'solde_restant';               niveau = 'alerte'   }
  else if (mouvOrphelin)                                { motif = 'credit_orphelin';              niveau = 'critique' }
  else if (resaSansVirement)                            { motif = 'rapproche_sans_virement';      niveau = 'alerte'   }

  return {
    statut_rapprochement:      statutRapprochement,
    rapprochement_mode:        rapprochementMode,
    nb_virements_lies:         nbVirLies,
    mouvement_orphelin:        mouvOrphelin,
    reservation_sans_virement: resaSansVirement,
    besoin_revue_humaine:      niveau !== 'information',
    motif_anomalie:            motif,
    niveau_anomalie:           niveau,
  }
}

/**
 * BLOC I — Facturation
 * Source : facture_evoliz WHERE proprietaire_id + mois + type_facture='honoraires'
 * ecart_reversement_eur : LOY_HT (ventilation) - montant_reversement (facture gelé à la génération)
 * Règle : si écart ≠ 0 → reventilation sans régénération facture → anomalie comptable
 */
function buildBlocI(facture, loyHt) {
  if (!facture) {
    return {
      facture_generee: false, facture_statut: '', facture_evoliz_id: '',
      facture_numero:  '', montant_reversement_proprietaire_eur: '', ecart_reversement_eur: '',
    }
  }
  const montantRev = facture.montant_reversement || 0
  return {
    facture_generee:                      true,
    facture_statut:                       facture.statut         || '',
    facture_evoliz_id:                    facture.id_evoliz      || '',
    facture_numero:                       facture.numero_facture || '',
    montant_reversement_proprietaire_eur: normalizeAmount(montantRev),
    ecart_reversement_eur:                normalizeAmount(loyHt - montantRev),
  }
}

/**
 * BLOC J — Métadonnées
 * Colonnes existantes (v1) + origine_donnee + version_export
 * origine_donnee : déduit du canal bancaire
 *   api_hospitable : airbnb, stripe
 *   csv_booking    : booking
 *   csv_banque     : tout le reste
 */
function buildBlocJ(mouv, resa, typePmt, descPmt) {
  const canal  = mouv.canal || ''
  const statut = mouv.statut_matching
  let origine = 'csv_banque'
  if (['airbnb', 'stripe'].includes(canal)) origine = 'api_hospitable'
  else if (canal === 'booking')             origine = 'csv_booking'

  return {
    'Type paiement':        typePmt || resa?.type_paiement || '',
    'Description paiement': descPmt || '',
    Note: statut === 'non_identifie' ? 'Non identifié' : statut === 'en_attente' ? 'En attente' : '',
    origine_donnee:         origine,
    version_export:         'rapprochement_v2_eclate',
  }
}

/**
 * Contrôles automatiques de cohérence
 * Score 0–100 : 20 points par contrôle OK (5 contrôles)
 * Règle : ctrl_ventilation_vs_revenu_ok → pass si pas de ventilation (non rapproché)
 */
function buildControls(agg, finRevenue, montantBancaire, statusNorm, moisResa, moisExport, totalTtc) {
  const rev  = finRevenue     || 0
  const bank = montantBancaire || 0

  // ctrl 1 : HT + TVA = TTC ±1 centime pour chaque code avec données
  let htTvaTtcOk = true
  for (const c of CODES_VENTIL) {
    const v = agg[c]
    if (!v.has) continue
    if (Math.abs((v.ht + v.tva) - v.ttc) > 1) { htTvaTtcOk = false; break }
  }

  // ctrl 2 : HON + FMEN + AUTO + LOY ≈ fin_revenue ±5% (décomposition interne cohérente)
  const hasVentil = CODES_VENTIL.some(c => agg[c].has)
  const honFmenAutoLoy = (agg['HON']?.ttc || 0) + (agg['FMEN']?.ttc || 0) +
                         (agg['AUTO']?.ttc || 0) + (agg['LOY']?.ht || 0)
  const ventRevOk = hasVentil && rev > 0
    ? Math.abs(honFmenAutoLoy - rev) / rev <= 0.05
    : true

  // ctrl 3 : montant bancaire ≈ fin_revenue ±200 centimes
  const bankRevOk = rev > 0 ? Math.abs(bank - rev) <= 200 : true

  // ctrl 4 : résa annulée → pas de flux bancaire entrant
  const statutOk = statusNorm !== 'annulee' || bank === 0

  // ctrl 5 : mois_comptable résa = mois export
  const moisOk = !moisResa || moisResa === moisExport

  const score     = [htTvaTtcOk, ventRevOk, bankRevOk, statutOk, moisOk].filter(Boolean).length * 20
  const fiabilite = score >= 90 ? 'fiable' : score >= 70 ? 'a_verifier' : 'incoherent'

  return {
    ctrl_ht_tva_ttc_ok:            htTvaTtcOk,
    ctrl_ventilation_vs_revenu_ok: ventRevOk,
    ctrl_mouvement_vs_revenu_ok:   bankRevOk,
    ctrl_statut_coherent_ok:       statutOk,
    ctrl_mois_coherent_ok:         moisOk,
    score_confiance:               score,
    niveau_fiabilite:              fiabilite,
  }
}

// ── En-têtes — 115 colonnes ───────────────────────────────────────

function buildHeaders() {
  const ventCols = CODES_VENTIL.flatMap(c => [`${c} HT`, `${c} TVA`, `${c} TTC`])
  return [
    // BLOC A (7)
    'version_export', 'date_export', 'mois_comptable', 'uuid_ligne',
    'id_mouvement', 'id_reservations', 'code_reservations',
    // BLOC B (10)
    'Date opération', 'Libellé virement', 'Référence', 'Entrée EUR', 'Sortie EUR',
    'Statut', 'canal_bancaire_detecte', 'date_operation_iso', 'montant_signe_eur', 'sens_mouvement',
    // BLOC C (17)
    'Bien(s)', 'Voyageur(s)', 'Plateforme', 'Arrivée', 'Départ', 'Nuits', 'Code résa',
    'statut_resa_normalise', 'sejour_proprietaire', 'annulee', 'import_manuel',
    'reservation_directe', 'payout_groupe', 'nb_reservations_liees', 'codes_resas_lies',
    'hospitable_id', 'payout_id',
    // BLOC D (7)
    'agence', 'bien_id', 'proprietaire_id', 'proprietaire_nom',
    'mode_encaissement', 'gestion_loyer', 'compte_airbnb',
    // BLOC E (4)
    'Revenu net EUR', 'Acompte EUR', 'solde_eur', 'pct_du_total',
    // BLOC F (39 : 11 × 3 + 6)
    ...ventCols,
    'auto_est_reel', 'total_ventilation_ht', 'total_ventilation_tva', 'total_ventilation_ttc',
    'ecart_vs_revenu_net_eur', 'ecart_vs_mouvement_bancaire_eur',
    // BLOC G (5)
    'part_dcb_eur', 'part_proprietaire_eur', 'part_taxe_eur', 'nature_flux', 'imputation_principale',
    // BLOC H (8)
    'statut_rapprochement', 'rapprochement_mode', 'nb_virements_lies',
    'mouvement_orphelin', 'reservation_sans_virement', 'besoin_revue_humaine',
    'motif_anomalie', 'niveau_anomalie',
    // BLOC I (6)
    'facture_generee', 'facture_statut', 'facture_evoliz_id', 'facture_numero',
    'montant_reversement_proprietaire_eur', 'ecart_reversement_eur',
    // BLOC J (5)
    'Type paiement', 'Description paiement', 'Note', 'origine_donnee', 'version_export',
    // CONTRÔLES (7)
    'ctrl_ht_tva_ttc_ok', 'ctrl_ventilation_vs_revenu_ok', 'ctrl_mouvement_vs_revenu_ok',
    'ctrl_statut_coherent_ok', 'ctrl_mois_coherent_ok', 'score_confiance', 'niveau_fiabilite',
  ]
}

function serializeRow(rowObj, headers) {
  return headers.map(h => q(rowObj[h] ?? '')).join(';')
}

// ── Construction d'une ligne ──────────────────────────────────────

function buildSingleRow({
  m, resa, resaIds, codes, resaDetails,
  ventByResa, factureByProprio, factureByBien, payoutByMouv,
  montantAcompte, typePmt, descPmt,
  mois, exportedAt,
}) {
  const { agg, nbVirLies } = aggregateVent(resaIds, ventByResa)

  const finRevenue = resa?.fin_revenue ?? 0

  const totalHt  = CODES_VENTIL.reduce((s, c) => s + (agg[c]?.ht  || 0), 0)
  const totalTva = CODES_VENTIL.reduce((s, c) => s + (agg[c]?.tva || 0), 0)
  const totalTtc = CODES_VENTIL.reduce((s, c) => s + (agg[c]?.ttc || 0), 0)

  const credit          = m.credit || 0
  const debit           = m.debit  || 0
  const montantBancaire = credit > 0 ? credit : debit

  const ecartVsRevenu   = finRevenue ? normalizeAmount(totalTtc - finRevenue) : ''
  const ecartVsBancaire = normalizeAmount(totalTtc - montantBancaire)

  const firstDetail = resaDetails[0] || {}
  const bienId    = firstDetail?.bien?.id
  const proprioId = firstDetail?.bien?.proprietaire_id
  // Priorité : facture per-bien, sinon facture globale du proprio (bug 5)
  const facture   = (bienId && factureByBien?.[bienId])
                 || (proprioId ? (factureByProprio[proprioId] || null) : null)
  const loyHt     = agg['LOY']?.ht || 0

  const statusNorm = normalizeStatus(firstDetail.final_status)
  const moisResa   = firstDetail.mois_comptable || ''

  return {
    ...buildBlocA(m, resaIds, codes, mois, exportedAt),
    ...buildBlocB(m),
    ...buildBlocC(m, resa, resaIds, codes, resaDetails, payoutByMouv),
    ...buildBlocD(resaDetails),
    ...buildBlocE(finRevenue, montantAcompte),
    ...buildBlocF(agg, totalHt, totalTva, totalTtc, ecartVsRevenu, ecartVsBancaire),
    ...buildBlocG(m, resa, agg),
    ...buildBlocH(m, resaDetails, resa, finRevenue, montantAcompte, nbVirLies),
    ...buildBlocI(facture, loyHt),
    ...buildBlocJ(m, resa, typePmt, descPmt),
    ...buildControls(agg, finRevenue, montantBancaire, statusNorm, moisResa, mois, totalTtc),
  }
}

// ── Export principal ──────────────────────────────────────────────

/**
 * Génère le CSV rapprochement comptable v2 (115 colonnes).
 * Mode éclaté : 1 ligne par réservation pour Stripe/Booking, 1 ligne par mouvement pour les autres.
 *
 * @param {Array}  mouvements - Tableau enrichi de getMouvementsMois()
 * @param {string} mois       - Format YYYY-MM
 * @returns {Promise<string>} CSV UTF-8 BOM, séparateur ;
 */
export async function exportCSVComptable(mouvements, mois) {
  const exportedAt    = new Date().toISOString()
  let   commentExport = ''

  // Collecter tous les reservation_ids nécessaires
  const allResaIds = []
  const allMouvIds = mouvements.map(m => m.id).filter(Boolean)

  for (const m of mouvements) {
    const r   = m._resa || {}
    const ids = r.reservation_ids || (r.id ? [r.id] : [])
    for (const id of ids) if (id && !allResaIds.includes(id)) allResaIds.push(id)
  }

  // Chargement parallèle — 5 requêtes + timeout 4,5 s
  let ventData = [], resaData = [], factData = [], payoutData = [], paiementData = []

  try {
    const loadAll = Promise.all([
      // Ventilation étendue — inclut montant_reel (AUTO réel) et mouvement_id (VIR liés)
      allResaIds.length
        ? supabase.from('ventilation')
            .select('reservation_id, code, montant_ht, montant_tva, montant_ttc, montant_reel, mouvement_id')
            .in('reservation_id', allResaIds)
        : Promise.resolve({ data: [] }),

      // Données résa : owner_stay, hospitable_id, final_status + bien + proprietaire
      allResaIds.length
        ? supabase.from('reservation')
            .select(`id, hospitable_id, owner_stay, final_status, mois_comptable,
              bien:bien_id(id, hospitable_name, agence, mode_encaissement, gestion_loyer,
                compte_airbnb, proprietaire_id, proprietaire:proprietaire_id(id, nom))`)
            .in('id', allResaIds)
        : Promise.resolve({ data: [] }),

      // Factures honoraires du mois — tous propriétaires
      supabase.from('facture_evoliz')
        .select('bien_id, proprietaire_id, id_evoliz, numero_facture, statut, montant_reversement')
        .eq('mois', mois)
        .eq('type_facture', 'honoraires'),

      // Payouts Hospitable — pour payout_id dans BLOC C
      allMouvIds.length
        ? supabase.from('payout_hospitable')
            .select('mouvement_id, id')
            .in('mouvement_id', allMouvIds)
        : Promise.resolve({ data: [] }),

      // Paiements Stripe/Booking — détail per-resa avec bien + proprietaire
      allMouvIds.length
        ? supabase.from('reservation_paiement')
            .select(`mouvement_id, reservation_id, montant, type_paiement, description_paiement,
              reservation:reservation_id(
                id, code, platform, guest_name, arrival_date, departure_date, nights, fin_revenue,
                hospitable_id, owner_stay, final_status, mois_comptable,
                bien:bien_id(id, hospitable_name, agence, mode_encaissement, gestion_loyer,
                  compte_airbnb, proprietaire_id, proprietaire:proprietaire_id(id, nom))
              )`)
            .in('mouvement_id', allMouvIds)
        : Promise.resolve({ data: [] }),
    ])

    const timeoutP = new Promise(res => setTimeout(() => res(null), 4500))
    const result   = await Promise.race([loadAll, timeoutP])

    if (result === null) {
      commentExport = 'export_partiel_timeout'
    } else {
      const [vR, rR, fR, pR, pmR] = result
      ventData     = vR?.data  || []
      resaData     = rR?.data  || []
      factData     = fR?.data  || []
      payoutData   = pR?.data  || []
      paiementData = pmR?.data || []
    }
  } catch (err) {
    commentExport = 'export_partiel_erreur:' + (err?.message || 'unknown')
  }

  // Maps de lookup
  const ventByResa = {}
  for (const v of ventData) {
    if (!ventByResa[v.reservation_id]) ventByResa[v.reservation_id] = []
    ventByResa[v.reservation_id].push(v)
  }

  const resaById = {}
  for (const r of resaData) resaById[r.id] = r

  // Factures indexées par bien_id (per-bien) ET par proprio (global fallback)
  // Si un proprio a plusieurs factures, bien_id prioritaire pour éviter écrasement (bug 5)
  const factureByBien    = {}
  const factureByProprio = {}
  for (const f of factData) {
    if (f.bien_id) factureByBien[f.bien_id] = f
    if (f.proprietaire_id) factureByProprio[f.proprietaire_id] = f
  }

  const payoutByMouv = {}
  for (const p of payoutData) {
    if (p.mouvement_id && !payoutByMouv[p.mouvement_id]) payoutByMouv[p.mouvement_id] = p.id
  }

  const paiementsByMouv = {}
  for (const p of paiementData) {
    if (!paiementsByMouv[p.mouvement_id]) paiementsByMouv[p.mouvement_id] = []
    if (!paiementsByMouv[p.mouvement_id].find(x => x.reservation_id === p.reservation_id)) {
      paiementsByMouv[p.mouvement_id].push(p)
    }
  }

  // Générer les lignes
  const headers = buildHeaders()
  const rows    = []

  for (const m of mouvements) {
    const r        = m._resa || {}
    const paiements = paiementsByMouv[m.id] || []

    if (paiements.length > 0 && ['stripe', 'booking'].includes(m.canal)) {
      // Mode éclaté — 1 ligne par réservation
      for (const p of paiements) {
        const singleResa  = p.reservation || {}
        const resaId      = singleResa.id
        const detailExtra = resaId ? (resaById[resaId] || {}) : {}
        const resaEnrichi = {
          ...singleResa,
          bien: singleResa.bien || detailExtra.bien || {},
        }
        const resaIds = resaId ? [resaId] : []
        const codes   = singleResa.code ? [singleResa.code] : []

        // Construire le _resa-like pour les champs agrégés BLOC C/E
        const resaLike = {
          fin_revenue:     singleResa.fin_revenue,
          platform:        singleResa.platform,
          arrival_date:    singleResa.arrival_date,
          departure_date:  singleResa.departure_date,
          nights:          singleResa.nights,
          guest_name:      singleResa.guest_name,
          bien_name:       singleResa.bien?.hospitable_name || '',
          biens:           singleResa.bien?.hospitable_name ? [singleResa.bien.hospitable_name] : [],
          guests:          singleResa.guest_name            ? [singleResa.guest_name]           : [],
          reservation_ids: resaIds,
          codes,
        }

        rows.push(serializeRow(
          buildSingleRow({
            m, resa: resaLike, resaIds, codes,
            resaDetails:    [resaEnrichi],
            ventByResa, factureByProprio, factureByBien, payoutByMouv,
            montantAcompte: p.montant || 0,
            typePmt:        p.type_paiement       || '',
            descPmt:        p.description_paiement|| '',
            mois, exportedAt,
          }),
          headers,
        ))
      }
    } else {
      // Mode agrégé — 1 ligne par mouvement
      const resaIds        = r.reservation_ids || (r.id ? [r.id] : [])
      const codes          = r.codes           || (r.code ? [r.code] : [])
      const resaDetails    = resaIds.map(id => resaById[id]).filter(Boolean)
      const montantAcompte = (m.credit || 0) > 0 ? (m.credit || 0) : 0

      rows.push(serializeRow(
        buildSingleRow({
          m, resa: r, resaIds, codes, resaDetails,
          ventByResa, factureByProprio, factureByBien, payoutByMouv,
          montantAcompte,
          typePmt: r.type_paiement || '',
          descPmt: '',
          mois, exportedAt,
        }),
        headers,
      ))
    }
  }

  // Sérialiser
  const headerLine = headers.map(q).join(';')
  let csv = '\uFEFF' + headerLine + '\n' + rows.join('\n')
  if (commentExport) csv += '\n' + q('commentaire_export:' + commentExport)
  return csv
}
