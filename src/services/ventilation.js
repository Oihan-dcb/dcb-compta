/**
 * Service de calcul de ventilation comptable
 * Transforme les financials Hospitable en lignes comptables DCB
 *
 * Codes ventilation :
 * COM  — Commission DCB sur les locations directes (Management fee sur CSV HOSP) — TVA 20%
 * MEN  — Forfait ménage Brut collecté auprès du voyageur (Cleaning fee + Community fee + Other fee + pet fee + resort fee) — Hors TVA
 * MGT  — Management fee résa directe — TVA 20%
 * AUTO — Débours auto-entrepreneur — Hors TVA
 * HON  — Honoraires de gestion DCB — TVA 20%
 * FMEN — Forfait ménage DCB (MEN - AUTO provisionnée) — TVA 20%
 * LOY  — Reversement propriétaire — Hors TVA
 * TAXE — Taxe de séjour — Hors TVA
 * DIV  — Frais divers DCB (expenses [DCB]) — TVA 20%
 * TAX  — Taxe de séjour (pass-through) — Hors TVA, tracé uniquement
 * MISC — Autre mouvements non identifiés (extra guest fee) — Hors TVA
 */

import { supabase } from '../lib/supabase'
import { logOp } from './journal'
import { AGENCE } from '../lib/agence'
import { authPost } from '../lib/authFetch'
import { _calculerLignes as _calculerLignesCore } from './ventilationCore'
// AIRBNB_LOY_RATE supprimé — remplacé par pro-rata du host_service_fee (voir dueToOwner Airbnb)

/**
 * Calcule et sauvegarde la ventilation pour toutes les réservations
 * d'un mois donné — délégué à /api/ventiler (service_role, pas de blocage RLS).
 *
 * @param {string} mois - YYYY-MM
 */
export async function calculerVentilationMois(mois) {
  const { ok, data } = await authPost('/api/ventiler', { mois, agence: AGENCE })
  if (!ok) throw new Error(data?.error || 'Erreur serveur ventilation')
  return data
}

/**
 * Agrège les séjours proprio (owner_stay=true) pour affichage séparé
 */
export function agregerSejoursProrio(reservations) {
  // Règle : toute resa owner_stay=true apparaît dans le tableau
  // FMEN = somme des lignes FMEN si ventilée, sinon 0
  const sejours = {}
  for (const resa of reservations) {
    if (!resa.owner_stay) continue
    const propId = resa.bien?.proprietaire_id || 'sans_proprio'
    const propNom = resa.bien?.proprietaire
      ? `${resa.bien.proprietaire.nom}${resa.bien.proprietaire.prenom ? ' ' + resa.bien.proprietaire.prenom : ''}`
      : resa.guest_name || 'Sans propriétaire'
    if (!sejours[propId]) {
      sejours[propId] = { id: propId, nom: propNom, total_fmen: 0, nb_resas: 0, biens: [] }
    }
    const p = sejours[propId]
    p.nb_resas++
    if (resa.bien?.code) p.biens.push(resa.bien.code)
    for (const l of (resa.ventilation || [])) {
      if (l.code === 'FMEN') p.total_fmen += l.montant_ttc
    }
  }
  // Toutes les resas proprio apparaissent, même sans FMEN
  return Object.values(sejours)
}

/**
 * Calcule les lignes de ventilation — fonction PURE, sans appel DB.
 * Utilisée directement dans les tests et appelée par calculerVentilationResa.
 * Depuis le 21/08/2026 (Étape 4, audit fusion des moteurs) : simple réexport du noyau
 * partagé ventilationCore.js, avec `agence` par défaut sur la constante du module pour
 * ne pas casser les appels existants (tests + calculerVentilationResa) qui ne la passent
 * jamais explicitement.
 * @param {object} resa — réservation avec bien, reservation_fee chargés
 * @returns {{ lignes: Array }} lignes de ventilation calculées
 */
export function _calculerLignes(resa, agence = AGENCE) {
  return _calculerLignesCore(resa, agence)
}

/**
 * Recalcule la ventilation d'une réservation individuelle —
 * délégué à /api/ventiler (service_role, pas de blocage RLS).
 */
export async function calculerVentilationResa(resa) {
  const { ok, data } = await authPost('/api/ventiler', { reservation_id: resa.id, agence: AGENCE })
  if (!ok) throw new Error(data?.error || 'Erreur serveur ventilation')
}

/**
 * Qualifie un ajustement Hospitable (voir migration 222) comme 'hebergement' ou 'menage'
 * et reventile la résa concernée — délégué à /api/qualifier-ajustement.
 */
export async function qualifierAjustement(ajustementId, type, { montantFmen, montantAuto } = {}) {
  const body = { ajustement_id: ajustementId, type }
  if (type === 'menage') { body.montant_fmen = montantFmen; body.montant_auto = montantAuto }
  const { ok, data } = await authPost('/api/qualifier-ajustement', body)
  if (!ok) throw new Error(data?.error || 'Erreur qualification ajustement')
  return data
}

// ligneTVA/ligneHorsTVA déplacées dans ventilationCore.js (Étape 4, 21/08/2026) — plus
// aucun appelant ici, _calculerLignes est un réexport du noyau partagé.

/**
 * Récupère la ventilation d'un mois, groupée par propriétaire
 */
export async function getVentilationMois(mois) {
  const { data, error } = await supabase
    .from('ventilation')
    .select(`
      *,
      reservation (code, platform, arrival_date, departure_date, nights, guest_name),
      bien (hospitable_name, code, agence),
      proprietaire (id, nom, prenom)
    `)
    .eq('mois_comptable', mois)
    .order('code')

  if (error) throw error
  return (data || []).filter(l => !l.bien?.agence || l.bien.agence === AGENCE)
}

/**
 * Récapitulatif de ventilation par code pour un mois
 */
export async function getRecapVentilation(mois) {
  const lignes = await getVentilationMois(mois)

  // Récap global par code
  const recap = {}
  for (const l of lignes) {
    if (!recap[l.code]) {
      recap[l.code] = { code: l.code, libelle: l.libelle, ht: 0, tva: 0, ttc: 0, nb: 0 }
    }
    recap[l.code].ht += l.montant_ht
    recap[l.code].tva += l.montant_tva
    recap[l.code].ttc += l.montant_ttc
    recap[l.code].nb++
  }

  // Récap par propriétaire
  const parProprio = {}
  for (const l of lignes) {
    const propId = l.proprietaire_id || 'sans_proprio'
    const propNom = l.proprietaire ? `${l.proprietaire.prenom || ''} ${l.proprietaire.nom || ''}`.trim() : 'Sans propriétaire'
    if (!parProprio[propId]) {
      parProprio[propId] = { id: propId, nom: propNom, codes: {}, total_com: 0, total_men: 0, total_loy: 0, total_auto: 0, total_vir: 0 }
    }
    const p = parProprio[propId]
    if (!p.codes[l.code]) p.codes[l.code] = { ht: 0, ttc: 0, nb: 0 }
    p.codes[l.code].ht += l.montant_ht
    p.codes[l.code].ttc += l.montant_ttc
    p.codes[l.code].nb++
    if (l.code === 'HON') p.total_com += l.montant_ttc  // TTC (TVA 20% incluse)
    if (l.code === 'FMEN') p.total_men += l.montant_ttc // TTC (TVA 20% incluse)
    if (l.code === 'LOY') p.total_loy += l.montant_ht   // HT = TTC (hors TVA)
    if (l.code === 'AUTO') p.total_auto += l.montant_ht // HT = TTC (hors TVA)
    if (l.code === 'VIR') p.total_vir += l.montant_ttc  // HT = TTC (hors TVA)
  }

  return {
    parCode: Object.values(recap),
    parProprio: Object.values(parProprio).sort((a, b) => a.nom.localeCompare(b.nom)),
    lignes,
  }
}

/**
 * Ajustement manuel « total constant » de la ventilation (fonctionnalité rare —
 * modal Réservations). `edits` = { CODE: nouveau_TTC_centimes } pour les lignes
 * prestations (HON, FMEN, AUTO). Le HT est recalculé (TTC / 1,20 pour les lignes
 * TVA, = TTC pour AUTO hors TVA) et LOY + VIR absorbent le delta → le total de la
 * résa est conservé PAR CONSTRUCTION. Pose reservation.ventilation_manuelle = true :
 * plus aucun recalcul auto (api/ventiler + ventilation-auto nightly, migration 226).
 */
/**
 * Verrou de saisie (cloture_bien) : throw si le bien/mois est clôturé — la facture
 * du bien est envoyée à Evoliz, les modifications sont figées jusqu'à réouverture.
 */
export async function verifierSaisieOuverte(bienId, mois) {
  if (!bienId || !mois) return
  const { data } = await supabase.from('cloture_bien').select('id')
    .eq('bien_id', bienId).eq('mois', mois).eq('active', true).limit(1)
  if (data?.length) {
    throw new Error('Saisie clôturée : la facture de ce bien/mois est envoyée à Evoliz. Rouvrez d\'abord la saisie depuis la Facturation (🔓 Rouvrir saisie — supprime aussi le brouillon Evoliz).')
  }
}

export async function ajusterVentilationManuelle(resa, edits) {
  // Facture envoyée = répartition figée (verrou cloture_bien posé à l'envoi Evoliz)
  await verifierSaisieOuverte(resa.bien?.id || resa.bien_id, resa.mois_comptable)
  const lignes = resa.ventilation || []
  const get = (c) => lignes.find(l => l.code === c)
  // MEN (ménage brut voyageur) : éditable mais HORS identité comptable
  // (total = LOY + HON + FMEN) → sa modification n'impacte PAS le LOY.
  const HORS_DELTA = ['MEN']
  const HORS_TVA = ['AUTO', 'MEN']
  let delta = 0
  const updates = []
  for (const [code, ttcNew] of Object.entries(edits)) {
    const l = get(code)
    if (!l || ttcNew == null || ttcNew < 0) continue
    const horsTVA = HORS_TVA.includes(code)
    const ttcOld = l.montant_ttc ?? l.montant_ht ?? 0
    if (ttcNew === ttcOld) continue
    const ht = horsTVA ? ttcNew : Math.round(ttcNew / 1.2)
    updates.push({ id: l.id, vals: { montant_ht: ht, montant_tva: horsTVA ? l.montant_tva : ttcNew - ht, montant_ttc: ttcNew, calcul_source: 'manual' } })
    if (!HORS_DELTA.includes(code)) delta += ttcOld - ttcNew
  }
  if (!updates.length) return { changed: false, delta: 0 }

  // LOY/VIR n'absorbent le delta que s'il y en a un (modifier seulement MEN → delta 0,
  // pas besoin de ligne LOY — ex. séjours propriétaires sans reversement)
  if (delta !== 0) {
    const loy = get('LOY')
    if (!loy) throw new Error('Ligne LOY absente — ajustement impossible sur cette résa')
    const loyNew = (loy.montant_ht || 0) + delta
    if (loyNew < 0) throw new Error('Le reversement propriétaire deviendrait négatif (' + (loyNew / 100).toFixed(2) + ' €)')
    updates.push({ id: loy.id, vals: { montant_ht: loyNew, montant_ttc: loyNew, calcul_source: 'manual' } })
    const vir = get('VIR')
    if (vir) updates.push({ id: vir.id, vals: { montant_ht: (vir.montant_ht || 0) + delta, montant_ttc: (vir.montant_ttc ?? vir.montant_ht ?? 0) + delta, calcul_source: 'manual' } })
  }

  for (const u of updates) {
    if (!u.id) throw new Error('Ligne de ventilation sans id — rechargez la page')
    const { error } = await supabase.from('ventilation').update(u.vals).eq('id', u.id)
    if (error) throw error
  }
  const { error: flagErr } = await supabase.from('reservation').update({ ventilation_manuelle: true }).eq('id', resa.id)
  if (flagErr) throw flagErr

  logOp({
    categorie: 'ventilation', action: 'ajustement_manuel', statut: 'ok', source: 'app',
    mois_comptable: resa.mois_comptable, reservation_id: resa.id, bien_id: resa.bien?.id || resa.bien_id,
    message: `Ajustement manuel ${resa.code} : ` + Object.entries(edits).map(([c, v]) => `${c}=${(v / 100).toFixed(2)}€ TTC`).join(', ') + ` → delta LOY ${(delta / 100).toFixed(2)}€ (total conservé)`,
    meta: { edits, delta },
  })
  return { changed: true, delta }
}

/** Lève le verrou d'ajustement manuel — la résa redevient recalculable par les moteurs auto. */
export async function reactiverVentilationAuto(resaId) {
  const { error } = await supabase.from('reservation').update({ ventilation_manuelle: false }).eq('id', resaId)
  if (error) throw error
}
