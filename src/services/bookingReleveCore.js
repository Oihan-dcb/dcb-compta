/**
 * bookingReleveCore.js — noyau PUR (aucun import supabase) du relevé Booking.com (lot L0, 19/10/2026).
 *
 * Deux usages :
 *  1. analyserReleveBooking() : aperçu AVANT validation d'un relevé téléchargé dans l'extranet
 *     (Finances › Versements, CSV ou XLSX, DCB ou Lauïan). Pour chaque versement Booking (payout) :
 *     virement bancaire retrouvé (PAYIN), lignes par réservation, contrôle Σ nets = virement reçu,
 *     écarts expliqués, état déjà importé / mois clôturé. Rien n'est écrit ici.
 *  2. proposerRapprochementBookingSansReleve() : rapprochement d'un PAYIN Booking SANS relevé, par
 *     la règle « cohorte du mois » (DCB : un virement par mois = tous les séjours partis le mois
 *     précédent) ou « séjour unique » (Lauïan : un virement par séjour). Vérifié sur les 17 virements
 *     DCB 06/2025 → 10/2026 et les 14 virements Lauïan 2026 : la cohorte = exactement les résas
 *     payées. Le relevé reste utile pour le DÉTAIL (commission, frais de paiement, taxe retenue,
 *     séjours absents d'Hospitable) mais n'est plus nécessaire pour prouver l'arrivée de l'argent.
 *
 * Montants en centimes. Glossaire : PAYIN = mouvement_bancaire entrant Booking ;
 * VIRPayinProuvé = résa reliée à ce PAYIN (reservation_paiement.mouvement_id).
 */

// ── Utilitaires ───────────────────────────────────────────────────────────────

export const eur = c => (Math.round(c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/** Référence de payout Booking présente dans le libellé bancaire : « …NO.TcOwPFVcrLAmj/ID.10415482 » */
export function refPayoutDuLibelle(m) {
  const t = `${m?.libelle || ''} ${m?.detail || ''}`
  const r = t.match(/NO\.([A-Za-z0-9]+)/i)
  return r ? r[1] : null
}

/** Identifiant extranet (hotel / partenaire) présent dans le libellé : « …/ID.10415482 » */
export function idExtranetDuLibelle(m) {
  const t = `${m?.libelle || ''} ${m?.detail || ''}`
  const r = t.match(/ID\.(\d{6,})/i)
  return r ? r[1] : null
}

const jours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)
const moisDe = d => (d || '').slice(0, 7)

/** Mois précédent / premier jour du mois d'une date AAAA-MM-JJ */
function premierDuMois(d) { return d.slice(0, 7) + '-01' }

// ── 1. Regroupement des lignes d'un relevé par versement ─────────────────────

/**
 * rowsByPayoutDate : sortie de parseBookingCSV (lignes groupées par date de versement).
 * Regroupe par payout_id quand il existe (nouveau format), sinon par date. Fusionne les lignes
 * d'une même réservation dans un même versement (réservation + ajustement) : la contrainte
 * UNIQUE(booking_ref, payout_date) n'admet qu'une ligne.
 */
export function regrouperParVersement(rowsByPayoutDate) {
  const groupes = {}
  for (const [pdate, rows] of Object.entries(rowsByPayoutDate || {})) {
    for (const r of rows) {
      const cle = r.payout_id ? 'id:' + r.payout_id : 'date:' + pdate
      const g = (groupes[cle] ||= { cle, payout_id: r.payout_id || null, payout_date: pdate, lignes: [], sans_ref: [], resumes: [] })
      if (r.est_resume) { g.resumes.push(r); continue }
      if (!r.booking_ref) { g.sans_ref.push(r); continue }
      const dej = g.lignes.find(l => l.booking_ref === r.booking_ref && l.payout_date === r.payout_date)
      if (dej) {
        for (const k of ['amount_cents', 'gross_cents', 'commission_cents', 'tourism_tax_cents', 'service_fee_cents']) dej[k] = (dej[k] || 0) + (r[k] || 0)
        dej.fusionnee = true
      } else g.lignes.push({ ...r })
    }
  }
  return Object.values(groupes).sort((a, b) => a.payout_date.localeCompare(b.payout_date))
}

// ── 2. Appariement versement ↔ virement bancaire (PAYIN) ─────────────────────

/**
 * Cherche le PAYIN d'un versement : 1) référence « NO.<payout_id> » dans le libellé (certain) ;
 * 2) sinon montant = Σ nets (±2 €) et date bancaire J+0…J+7 après la date de versement, unique.
 */
export function apparierVirement(groupe, mouvements, dejaPris = new Set()) {
  const libres = (mouvements || []).filter(m => !dejaPris.has(m.id) && (m.credit || 0) > 0)
  if (groupe.payout_id) {
    const m = libres.find(x => (refPayoutDuLibelle(x) || '').toUpperCase() === groupe.payout_id.toUpperCase())
    if (m) return { mouvement: m, par: 'reference' }
  }
  const somme = groupe.lignes.reduce((s, l) => s + (l.amount_cents || 0), 0) + groupe.sans_ref.reduce((s, l) => s + (l.amount_cents || 0), 0)
  const cands = libres.filter(m => {
    const d = jours(groupe.payout_date, m.date_operation)
    // une référence NO.xxx différente dans le libellé = un autre versement : exclu
    const ref = refPayoutDuLibelle(m)
    if (ref && groupe.payout_id && ref.toUpperCase() !== groupe.payout_id.toUpperCase()) return false
    return d >= 0 && d <= 7 && Math.abs((m.credit || 0) - somme) <= 200
  })
  if (cands.length === 1) return { mouvement: cands[0], par: 'montant_date' }
  if (cands.length > 1) return { mouvement: null, par: 'ambigu', candidats: cands.length }
  return { mouvement: null, par: null }
}

// ── 3. Explication d'un écart ligne ↔ réservation ────────────────────────────

/**
 * Écart entre le net versé par Booking pour une résa et le revenu attendu (fin_revenue Hospitable).
 * Retourne { code, texte } ; code 'ok' si identique.
 */
export function expliquerEcartLigne(ligne, resa) {
  if (!resa) return { code: 'resa_inconnue', texte: 'Séjour payé par Booking mais absent des réservations (non synchronisé par Hospitable, ou autre compte) : à créer, part propriétaire à reverser' }
  const net = ligne.amount_cents || 0
  const attendu = resa.fin_revenue || 0
  const e = net - attendu
  if (e === 0) return { code: 'ok', texte: '' }
  const tx = ligne.tourism_tax_cents || 0, fr = ligne.service_fee_cents || 0
  if (Math.abs(e) <= 100) return { code: 'arrondi', texte: `Écart de ${eur(e)} : arrondi des frais de paiement Booking (centimes)` }
  if (resa.final_status && resa.final_status !== 'accepted') return { code: 'annulee', texte: `Réservation ${resa.final_status === 'cancelled' ? 'annulée' : resa.final_status} : Booking verse ${eur(net)} (frais d'annulation / remboursement partiel), revenu Hospitable ${eur(attendu)}` }
  if (net < 0) return { code: 'remboursement', texte: `Montant négatif : remboursement ou ajustement Booking (${eur(net)})` }
  if (tx && Math.abs(e + tx) <= 100) return { code: 'taxe_dans_revenu', texte: `Écart ${eur(e)} = taxe de séjour retenue par Booking (${eur(tx)}) comptée dans le revenu Hospitable` }
  if (fr && Math.abs(e + fr) <= 100) return { code: 'frais_dans_revenu', texte: `Écart ${eur(e)} = frais de paiement Booking (${eur(fr)}) non déduits du revenu Hospitable` }
  if (tx && fr && Math.abs(e + tx + fr) <= 100) return { code: 'taxe_frais_dans_revenu', texte: `Écart ${eur(e)} = taxe retenue (${eur(tx)}) + frais de paiement (${eur(fr)}) comptés dans le revenu Hospitable` }
  return { code: 'inexplique', texte: `Écart ${eur(e)} non expliqué : net Booking ${eur(net)}, revenu Hospitable ${eur(attendu)} (modification de séjour, ajustement ?)` }
}

// ── 4. Analyse complète (aperçu avant validation) ────────────────────────────

/**
 * @param groupes        regrouperParVersement(...)
 * @param ctx.agence     agence courante
 * @param ctx.mouvements PAYIN Booking de l'agence sur la période ({id,date_operation,credit,libelle,detail,statut_matching,mois_releve})
 * @param ctx.reservations résas Booking des refs du fichier ({id, platform_id, code, fin_revenue, final_status, mois_comptable, rapprochee, bien:{agence, code, gestion_loyer}})
 * @param ctx.paiements  reservation_paiement de ces résas ({reservation_id, mouvement_id, montant})
 * @param ctx.lignesExistantes booking_payout_line existantes ({booking_ref, payout_date, amount_cents, commission_cents, service_fee_cents, tourism_tax_cents, mouvement_id})
 * @param ctx.moisClotures Set des mois AAAA-MM dont l'étape « Rapprochement » est clôturée pour l'agence
 */
export function analyserReleveBooking(groupes, ctx) {
  const { agence, mouvements = [], reservations = [], paiements = [], lignesExistantes = [], moisClotures = new Set() } = ctx
  const resaParRef = {}
  for (const r of reservations) { if (r.platform_id) resaParRef[r.platform_id] = r; if (r.code && !resaParRef[r.code]) resaParRef[r.code] = r }
  const existe = {}
  for (const l of lignesExistantes) existe[l.booking_ref + '|' + l.payout_date] = l
  const pris = new Set()
  const versements = []

  for (const g of groupes) {
    const app = apparierVirement(g, mouvements, pris)
    const mouv = app.mouvement
    if (mouv) pris.add(mouv.id)
    const moisMouv = mouv ? (mouv.mois_releve || moisDe(mouv.date_operation)) : null
    const virementCloture = !!(moisMouv && moisClotures.has(moisMouv))

    const lignes = g.lignes.map(l => {
      const resa = resaParRef[l.booking_ref] || null
      const autreAgence = !!(resa && resa.bien?.agence && resa.bien.agence !== agence)
      const ecart = expliquerEcartLigne(l, autreAgence ? null : resa)
      const pResa = resa ? paiements.filter(p => p.reservation_id === resa.id) : []
      const pCe = mouv ? pResa.find(p => p.mouvement_id === mouv.id) : null
      const pAutres = pResa.filter(p => !mouv || p.mouvement_id !== mouv.id)
      const ex = existe[l.booking_ref + '|' + l.payout_date]
      const dejaImportee = !!(ex && ex.amount_cents === l.amount_cents && (ex.commission_cents || 0) === (l.commission_cents || 0)
        && (ex.service_fee_cents || 0) === (l.service_fee_cents || 0) && (ex.tourism_tax_cents || 0) === (l.tourism_tax_cents || 0)
        && (ex.mouvement_id || null) === (mouv?.id || null))
      const resaCloturee = !!(resa && moisClotures.has(resa.mois_comptable))
      // Action sur le paiement de la résa (VIRPayinProuvé) si le relevé est validé
      let actionPaiement = 'aucune'
      if (mouv && resa && !autreAgence && !virementCloture && !resaCloturee) {
        if (pCe) actionPaiement = pCe.montant === l.amount_cents ? 'aucune' : 'corriger_montant'
        else if (pAutres.length) actionPaiement = 'deja_sur_autre_virement'
        else actionPaiement = 'creer'
      } else if (mouv && resa && (virementCloture || resaCloturee) && (!pCe || pCe.montant !== l.amount_cents)) actionPaiement = 'a_regulariser'
      return {
        ...l,
        resa_id: resa?.id || null, bien: resa?.bien?.code || null, mois_comptable: resa?.mois_comptable || null,
        fin_revenue: resa?.fin_revenue ?? null, final_status: resa?.final_status || null,
        ecart_cents: resa && !autreAgence ? (l.amount_cents || 0) - (resa.fin_revenue || 0) : null,
        ecart, autre_agence: autreAgence, deja_importee: dejaImportee, resa_cloturee: resaCloturee,
        paiement_actuel: pCe?.montant ?? null, paiement_autre_virement: pAutres.length ? pAutres.map(p => p.mouvement_id) : null,
        action_paiement: actionPaiement,
      }
    })

    const sommeNets = lignes.reduce((s, l) => s + (l.amount_cents || 0), 0) + g.sans_ref.reduce((s, l) => s + (l.amount_cents || 0), 0)
    const ecartVirement = mouv ? (mouv.credit || 0) - sommeNets : null
    const tot = k => lignes.reduce((s, l) => s + Math.abs(l[k] || 0), 0)
    const problemes = []
    if (!mouv) problemes.push(app.par === 'ambigu'
      ? `${app.candidats} virements Booking possibles au même montant : relier à la main`
      : 'Virement bancaire pas encore reçu / relevé bancaire pas importé : lignes gardées en attente')
    if (mouv && ecartVirement !== 0) problemes.push(`Σ des lignes ${eur(sommeNets)} ≠ virement reçu ${eur(mouv.credit)} (écart ${eur(ecartVirement)})`)
    if (g.sans_ref.length) problemes.push(`${g.sans_ref.length} ligne(s) sans numéro de réservation (${eur(g.sans_ref.reduce((s, l) => s + (l.amount_cents || 0), 0))}) : frais / ajustement Booking non rattachable`)
    for (const l of lignes) {
      if (l.autre_agence) problemes.push(`${l.booking_ref} appartient à une autre agence : relevé du mauvais compte Booking ?`)
      else if (l.ecart.code !== 'ok' && l.ecart.code !== 'arrondi') problemes.push(`${l.booking_ref}${l.bien ? ' (' + l.bien + ')' : ''} — ${l.ecart.texte}`)
      if (l.action_paiement === 'deja_sur_autre_virement') problemes.push(`${l.booking_ref} déjà rapprochée à un autre virement : non modifiée, à vérifier`)
    }
    const aRegulariser = []
    if (virementCloture) aRegulariser.push(`Virement du ${mouv.date_operation} : mois ${moisMouv} clôturé (Rapprochement) — rien n'est écrit`)
    for (const l of lignes) if (l.action_paiement === 'a_regulariser') aRegulariser.push(`${l.booking_ref}${l.bien ? ' (' + l.bien + ')' : ''} : mois ${l.resa_cloturee ? l.mois_comptable : moisMouv} clôturé — paiement ${l.paiement_actuel != null ? eur(l.paiement_actuel) : 'absent'} → ${eur(l.amount_cents)} à régulariser à la main`)

    const toutDejaImporte = lignes.length > 0 && lignes.every(l => l.deja_importee) && lignes.every(l => l.action_paiement === 'aucune' || l.action_paiement === 'a_regulariser')
    let etat
    if (virementCloture) etat = 'cloture'
    else if (toutDejaImporte && (!mouv || ecartVirement === 0)) etat = 'deja_importe'
    else if (!mouv) etat = 'sans_virement'
    else if (ecartVirement !== 0 || lignes.some(l => l.autre_agence)) etat = 'ecart'
    else etat = 'ok'

    versements.push({
      cle: g.cle, payout_id: g.payout_id, payout_date: g.payout_date,
      mouvement: mouv ? { id: mouv.id, date_operation: mouv.date_operation, credit: mouv.credit, statut_matching: mouv.statut_matching, mois: moisMouv, detail: mouv.detail || '' } : null,
      appariement: app.par, lignes, sans_ref: g.sans_ref, somme_nets: sommeNets, ecart_virement: ecartVirement,
      total_brut: lignes.reduce((s, l) => s + (l.gross_cents || 0), 0), total_commission: tot('commission_cents'),
      total_frais: tot('service_fee_cents'), total_taxe: tot('tourism_tax_cents'),
      etat, problemes, a_regulariser: aRegulariser,
      // Validation possible ? jamais pour un mois clôturé ; une ligne d'une autre agence bloque tout le versement
      validable: !virementCloture && !lignes.some(l => l.autre_agence) && etat !== 'deja_importe',
    })
  }

  const resume = {
    versements: versements.length,
    lignes: versements.reduce((s, v) => s + v.lignes.length, 0),
    ok: versements.filter(v => v.etat === 'ok').length,
    ecart: versements.filter(v => v.etat === 'ecart').length,
    sans_virement: versements.filter(v => v.etat === 'sans_virement').length,
    deja_importe: versements.filter(v => v.etat === 'deja_importe').length,
    cloture: versements.filter(v => v.etat === 'cloture').length,
    a_valider: versements.filter(v => v.validable).length,
  }
  return { versements, resume }
}

/**
 * Texte du champ mouvement_bancaire.detail après import du relevé. Le détail d'origine de la banque
 * (référence de virement, « NO.<payout>/ID.<extranet> ») est CONSERVÉ à la suite : seul un résumé
 * « Booking | … » d'un import précédent est remplacé.
 */
export function detailMouvementBooking(v) {
  const n = v.lignes.length
  const resume = `Booking | ${n} résa(s) | commission: ${(v.total_commission / 100).toFixed(2)}€ | frais paiement: ${(v.total_frais / 100).toFixed(2)}€`
    + (v.total_taxe ? ` | taxe séjour retenue: ${(v.total_taxe / 100).toFixed(2)}€` : '')
    + (v.payout_id ? ` | ref: ${v.payout_id}` : '')
  const avant = String(v.mouvement?.detail || '')
  const banque = avant.includes(' || banque: ') ? avant.split(' || banque: ').pop() : (avant.startsWith('Booking |') ? '' : avant)
  return banque.trim() ? `${resume} || banque: ${banque.trim()}` : resume
}

// ── 5. Rapprochement sans relevé (règle du mois / séjour unique) ─────────────

/**
 * @param mouvement  PAYIN Booking en attente { id, date_operation, credit }
 * @param candidats  résas Booking de l'agence, bien en gestion loyer, fin_revenue > 0, SANS aucun
 *                   reservation_paiement ({ id, platform_id, departure_date, fin_revenue })
 * @returns { regle: 'cohorte'|'sejour_unique', resas, ecart } ou null (→ relevé nécessaire)
 *
 * Cohorte : tous les candidats partis AVANT le 1er du mois du virement (et ≤ 75 j avant) ; accepté si
 *   |Σ fin_revenue − virement| ≤ max(2 €, 0,30 € × nb résas) (arrondis des frais de paiement Booking :
 *   3,07 € sur 12 résas en 06/2026, 0 € en 09 et 10/2026).
 * Séjour unique : un seul candidat parti dans les 30 j avant le virement, à ±2 € du montant.
 */
export function proposerRapprochementBookingSansReleve(mouvement, candidats) {
  const d = mouvement?.date_operation
  const credit = mouvement?.credit || 0
  if (!d || credit <= 0) return null
  const debutMois = premierDuMois(d)
  const cohorte = (candidats || []).filter(r => r.departure_date && r.departure_date < debutMois && jours(r.departure_date, d) <= 75 && (r.fin_revenue || 0) > 0)
  if (cohorte.length) {
    const somme = cohorte.reduce((s, r) => s + r.fin_revenue, 0)
    const tol = Math.max(200, 30 * cohorte.length)
    if (Math.abs(credit - somme) <= tol) return { regle: 'cohorte', resas: cohorte, ecart: credit - somme }
  }
  const proches = (candidats || []).filter(r => r.departure_date && r.departure_date < d && jours(r.departure_date, d) <= 30 && Math.abs((r.fin_revenue || 0) - credit) <= 200)
  if (proches.length === 1) return { regle: 'sejour_unique', resas: proches, ecart: credit - proches[0].fin_revenue }
  return null
}

// ── 6. Suivi des virements Booking (détail présent / manquant) ───────────────

/**
 * @param mouvements PAYIN Booking ({id, date_operation, credit, libelle, detail, statut_matching})
 * @param paiements  reservation_paiement de ces mouvements ({mouvement_id, montant})
 * @param lignes     booking_payout_line de ces mouvements ({mouvement_id, amount_cents})
 * etat : 'detaille' | 'detail_ecart' | 'sans_detail' | 'non_rapproche'
 */
export function suiviVirementsBooking(mouvements, paiements, lignes) {
  return (mouvements || []).filter(m => (m.credit || 0) > 0).map(m => {
    const p = (paiements || []).filter(x => x.mouvement_id === m.id)
    const l = (lignes || []).filter(x => x.mouvement_id === m.id)
    const sommeP = p.reduce((s, x) => s + (x.montant || 0), 0)
    const sommeL = l.reduce((s, x) => s + (x.amount_cents || 0), 0)
    let etat
    if (l.length && sommeL === m.credit) etat = 'detaille'
    else if (l.length) etat = 'detail_ecart'
    else if (p.length) etat = 'sans_detail'
    else etat = 'non_rapproche'
    return { id: m.id, date_operation: m.date_operation, credit: m.credit, ref_payout: refPayoutDuLibelle(m), id_extranet: idExtranetDuLibelle(m),
      statut_matching: m.statut_matching, nb_resas: p.length, somme_resas: sommeP, nb_lignes: l.length, somme_lignes: sommeL, etat }
  }).sort((a, b) => b.date_operation.localeCompare(a.date_operation))
}
