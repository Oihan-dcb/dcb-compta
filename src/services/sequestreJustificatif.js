// ── Justificatif du séquestre location saisonnière (I-161, 25/09/2026) ──────────────────────
// « On doit être capable à tout moment de justifier chaque euro du séquestre » (Oïhan).
// Loi Hoguet : le séquestre est un compte de mandants — solde bancaire réel (Pennylane) =
// somme de ce qui est dû à chacun. Modèle par mois comptable M (réservations de M) :
//
//   Mois facturé (factures d'honoraires émises) :
//     • Propriétaires : reversements facturés (montant_reversement) − remises SEPA / virements
//     • AE            : ménages + extras du mois − paiements (reconnus au nom de l'AE)
//     • DCB           : ENCAISSÉ du mois − reversements dus − AE dus − virements DCB déjà faits
//                       (= ce que le séquestre détient réellement encore pour DCB). Comparé à la
//                       part DCB THÉORIQUE (page Comptabilité + frais retenus) : la différence
//                       met en évidence les anomalies (virement en double, encaissement manquant…).
//   Mois non facturé (en cours, séjours à venir) : encaissé − déjà sorti.
//   Hors mois : débours remboursés par les propriétaires (financent les AE avancés), factures
//   payées sur le séquestre (dues à DCB), frais Stripe / bancaires, transits, non rapprochés.
//   Écart = solde réel − total justifié → doit être 0.
// Classement des mouvements : sequestreCore.js (pur, testé).

import { supabase } from '../lib/supabase.js'
import { classerSortie, classerEntree, apparierTransits, moisDe } from './sequestreCore.js'
import { buildComptaMensuelle } from './buildComptaMensuelle.js'

export const PENNYLANE_SEQUESTRE_LC = '14431436800'
export const SOURCE_SEQUESTRE_LC = 'Pennylane_LOCATION_SAISONNIERE'
// Relevé du séquestre : import CSV Caisse d'Épargne (source 'CaisseEpargne') jusqu'au 30/06/2026,
// Pennylane ensuite (connecté le 06/07, historique partiel avant juillet : aucun mouvement de juin).
// Jamais les deux sur une même période (sinon doublons).
// Relevé CaisseEpargne jusqu'au 03/07 inclus ; flux Pennylane complet à partir du 06/07 (vérifié
// 25/09/2026 : les 11 mouvements CE du 01-03/07 n'ont AUCUN équivalent Pennylane)
export const BASCULE_PENNYLANE = '2026-07-04'
// Premier mois suivi : le relevé Pennylane du séquestre commence le 09/04/2026 ; mai est le
// dernier mois intégralement antérieur. Les mois antérieurs sont réputés soldés — un reste
// éventuel ressort dans l'écart.
// Premier mois complet du compte séquestre CE (ouvert à 0 le 24/12/2025 — relevé complet vérifié le 25/09/2026)
export const MOIS_DEBUT = '2026-01'
const DEBUT = `${MOIS_DEBUT}-01`

const STATUTS_EXCLUS_RESA = ['cancelled', 'deleted', 'not_accepted', 'not accepted', 'declined', 'expired', 'request', 'checkpoint', 'checkpoint voided']
const moisPlus = (mois, n) => { const [y, m] = mois.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0)

async function toutes(q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function soldeBancaireSequestre(pennylaneId = PENNYLANE_SEQUESTRE_LC) {
  const { data, error } = await supabase.functions.invoke('pennylane-proxy', { body: { action: 'listBankAccounts', payload: {} } })
  if (error) throw new Error(`Pennylane : ${error.message}`)
  const compte = (data?.data?.items || []).find(a => String(a.id) === String(pennylaneId))
  if (!compte) throw new Error('Compte séquestre location saisonnière introuvable dans Pennylane')
  return { montant: Math.round(Number(compte.balance) * 100), maj: compte.updated_at }
}

// ── Fiche du compte séquestre de l'agence (migration 278) ─────────────────────────────────────
// sources = [{source, du, au}] : périodes pendant lesquelles chaque source bancaire EST le relevé du
// compte (jamais deux sources pour une même opération : recoupé avec le relevé de la banque)
export async function compteSequestre(agence) {
  const { data, error } = await supabase.from('sequestre_compte').select('*').eq('agence', agence).maybeSingle()
  if (error) throw error
  if (data) return data
  // Repli historique DCB (avant la migration 278)
  if (agence === 'dcb') return { agence, sources: [{ source: 'CaisseEpargne', du: '2025-12-24', au: '2026-07-03' }, { source: 'csv', du: '2025-12-24', au: '2026-07-03' }, { source: SOURCE_SEQUESTRE_LC, du: BASCULE_PENNYLANE, au: null }],
    ouverture_date: '2025-12-23', ouverture_solde: 0, mois_debut: MOIS_DEBUT, pennylane_account_id: PENNYLANE_SEQUESTRE_LC, autres_agences_regex: 'lauian' }
  throw new Error(`Aucun compte séquestre configuré pour l'agence ${agence} (table sequestre_compte)`)
}
const dansCompte = (compte, source, date) => (compte.sources || []).some(x => x.source === source && date >= x.du && (!x.au || date <= x.au))
const filtreSources = compte => (compte.sources || []).map(x => `and(source.eq.${x.source},date_operation.gte.${x.du}${x.au ? `,date_operation.lte.${x.au}` : ''})`).join(',')

// Solde du relevé importé = ouverture + mouvements. C'est lui qu'on justifie (chaque euro importé
// attribué). Le solde de la banque (Pennylane, ou saisi à la main) sert de contrôle d'IMPORT : un
// écart = mouvements pas encore importés (ex. Pennylane resynchronisé en journée) ou en double.
async function soldeReleve(compte, date) {
  const mv = await toutes(() => supabase.from('mouvement_bancaire').select('credit, debit').eq('agence', compte.agence)
    .lte('date_operation', date).or(filtreSources(compte)).neq('statut_matching', 'ignore'))
  return (compte.ouverture_solde || 0) + sum(mv, m => (m.credit || 0) - (m.debit || 0))
}
async function soldeCompte(compte, date) {
  const releve = await soldeReleve(compte, date)
  let banque = null
  if (compte.pennylane_account_id) banque = await soldeBancaireSequestre(compte.pennylane_account_id)
  else if (compte.solde_manuel != null) banque = { montant: compte.solde_manuel, maj: `${compte.solde_manuel_date} (saisi)`, date: compte.solde_manuel_date }
  // maj : horodatage (colonne timestamptz) — celui de la synchro Pennylane, sinon l'instant du calcul
  return { montant: releve, maj: (compte.pennylane_account_id && banque?.maj) || new Date().toISOString(), banque }
}

export async function justifierSequestre(agence = 'dcb', { date = new Date().toISOString().slice(0, 10), solde = null, moisDebut = null } = {}) {
  const compte = await compteSequestre(agence)
  moisDebut = moisDebut || compte.mois_debut || MOIS_DEBUT
  const autreAgenceRe = compte.autres_agences_regex ? new RegExp(`\\b(${compte.autres_agences_regex})\\b`) : null
  const moisCourant = moisDe(date)
  const MOIS_DEBUT_ = moisDebut, DEBUT_ = `${moisDebut}-01`
  const [aes, proprietaires, mvts, factures, reservations, affectations] = await Promise.all([
    toutes(() => supabase.from('auto_entrepreneur').select('id, nom, prenom, type')),
    toutes(() => supabase.from('proprietaire').select('id, nom, prenom, email').eq('agence', agence)),
    toutes(() => supabase.from('mouvement_bancaire')
      .select('id, date_operation, libelle, detail, credit, debit, canal, statut_matching, source')
      .eq('agence', agence).lte('date_operation', date)
      // Avant la bascule : relevé CE importé en deux sources complémentaires (« CaisseEpargne » +
      // « csv », surtout les crédits de janvier-mars) — recoupé ligne à ligne avec le relevé complet
      // du compte le 25/09/2026 (630 opérations, 0 manquante après complément, doublons en 'ignore')
      .or(filtreSources(compte))
      .neq('statut_matching', 'ignore').order('date_operation')),
    toutes(() => supabase.from('facture_evoliz')
      .select('id, mois, type_facture, statut, total_ttc, total_ttc_evoliz, montant_reversement, bien_id, proprietaire_id, numero_facture, date_paiement, bien:bien_id(code), proprietaire:proprietaire_id(nom)')
      .eq('agence', agence).gte('mois', MOIS_DEBUT_ < '2026-01' ? MOIS_DEBUT_ : '2026-01')),
    toutes(() => supabase.from('reservation')
      .select('id, code, mois_comptable, platform, final_status, fin_revenue, bien:bien_id!inner(agence, mode_encaissement, proprietaire_id)')
      .eq('bien.agence', agence).gte('mois_comptable', MOIS_DEBUT_)),
    toutes(() => supabase.from('sequestre_affectation').select('mouvement_id, type, sous, mois, note, tiers_id')),
  ])
  // Alias de libellés par tiers (migration 279) : mémorisés par la boîte « À affecter »
  const { data: aliasLibelles } = await supabase.from('sequestre_alias').select('sens, motif, type, sous, tiers_type, tiers_id, note').eq('agence', agence)
  const normTxt = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const parAlias = (m, sens) => {
    const t = normTxt(`${m.libelle || ''} ${m.detail || ''}`)
    const a = (aliasLibelles || []).find(x => (x.sens === sens || x.sens === 'les_deux') && t.includes(normTxt(x.motif)))
    return a ? { type: a.type, sous: a.sous || undefined, tiers_id: a.tiers_id || undefined, note: a.note || `alias « ${a.motif} »`, regle: 'alias' } : null
  }
  // Réaffectations manuelles (migration 277) : priment sur le classement par libellé
  const affecte = new Map(affectations.map(a => [a.mouvement_id, a]))
  // Priorité : affectation manuelle du mouvement > alias de libellé > règles automatiques
  const forcer = (m, c, sens) => {
    const a = affecte.get(m.id)
    if (a) return { ...c, type: a.type, sous: a.sous ?? c.sous, mois: a.mois ?? c.mois, tiers_id: a.tiers_id ?? c.tiers_id, note: a.note, regle: 'affectation_manuelle' }
    const al = sens ? parAlias(m, sens) : null
    return al ? { ...c, ...al } : { ...c, regle: 'auto' }
  }
  // Fiches propriétaire sans bien (co-titulaire, doublon resté après fusion — « Peres Hélène » =
  // co-titulaire de BURGY 416/602, « ELISSALT Hélène » doublon de la fiche ONGI) : un virement à leur
  // nom est attribué au propriétaire qui a des biens et partage leur adresse email
  const { data: biensProprio } = await supabase.from('bien').select('proprietaire_id, code').eq('agence', agence).not('proprietaire_id', 'is', null)
  const avecBien = new Set((biensProprio || []).map(b => b.proprietaire_id))
  const emails = p => (p.email || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
  const alias = new Map()
  for (const p of proprietaires.filter(p => !avecBien.has(p.id))) {
    const titulaire = proprietaires.find(q => avecBien.has(q.id) && emails(q).some(e => emails(p).includes(e)))
    if (titulaire) alias.set(p.id, titulaire.id)
  }
  const ctx = { aes: aes.filter(a => a.type === 'ae'), proprietaires: proprietaires.filter(p => avecBien.has(p.id) || alias.has(p.id)), biens: biensProprio || [], autreAgenceRe }
  const facturesMontants = factures.filter(f => ['honoraires', 'debours'].includes(f.type_facture)).map(f => ({
    type_facture: f.type_facture, proprio_nom: f.proprietaire?.nom, bien_code: f.bien?.code,
    montants: [f.total_ttc, f.total_ttc_evoliz].filter(Boolean),
  }))

  // Réservations dont DCB encaisse l'argent (biens « DCB encaisse », ou résas directes /
  // manuelles des biens où le propriétaire encaisse le reste). Une annulée avec revenu (frais
  // d'annulation versés par Airbnb) est ventilée et facturée comme les autres — même règle que
  // buildComptaMensuelle (non ventilable ET fin_revenue = 0 → exclue).
  const exclue = r => STATUTS_EXCLUS_RESA.includes(r.final_status) && !(r.fin_revenue > 0)
  const resaDCB = new Map(reservations
    .filter(r => !exclue(r) && (r.bien?.mode_encaissement !== 'proprio' || ['direct', 'manual'].includes(r.platform)))
    .map(r => [r.id, r]))

  // Preuves de paiement : encaissement de chaque réservation (toutes dates ≤ date du justificatif)
  const resaIds = [...resaDCB.keys()]
  const preuves = []
  for (let i = 0; i < resaIds.length; i += 200) {
    const { data, error: ePrv } = await supabase.from('reservation_paiement')
      .select('reservation_id, mouvement_id, montant, mouvement:mouvement_id(date_operation, source, agence)')
      .in('reservation_id', resaIds.slice(i, i + 200))
    if (ePrv) throw ePrv
    preuves.push(...(data || []))
  }
  const encaisseParMois = {}
  let encaisseAnterieurApres = 0 // séjours d'avant le suivi payés sur le compte après son début
  const creanceAutreAgence = [] // paiements de nos résas arrivés sur le séquestre d'une autre agence
  const encProprio = {} // mois → proprietaire_id → encaissé (détail des anomalies)
  const lieParMvt = new Map()
  for (const p of preuves || []) {
    if (!p.mouvement_id || !p.mouvement || p.mouvement.date_operation > date) continue
    // Seuls les paiements arrivés SUR CE COMPTE comptent : un paiement reçu sur l'ancien séquestre
    // (BudgetBakers, avant le changement de banque du 28/01/2026) ou sur le courant est déjà dans le
    // solde repris (7 443,18 €) ou n'est pas au séquestre — sinon compté deux fois (25/09/2026 : −7,6 k€)
    // Payé sur le séquestre d'une AUTRE agence (même nom de source bancaire possible : les deux
    // relevés CE s'appellent « CaisseEpargne ») : créance sur cette agence, pas un encaissement ici
    // → compté comme encaissé du mois (la résa est bien payée, ses ayants droit sont dus) ET porté en
    // poche négative « à recevoir » (l'argent n'est pas sur ce compte). Avant : exclu de l'encaissé ET
    // compté en positif → le manque était compté deux fois (Lauïan, résas payées sur le Stripe DCB :
    // écart −8 874,66 € au 26/09/2026).
    if (p.mouvement.agence && p.mouvement.agence !== agence) {
      if (p.mouvement.date_operation >= DEBUT_) {
        creanceAutreAgence.push({ agence: p.mouvement.agence, reservation_id: p.reservation_id, montant: p.montant || 0, date: p.mouvement.date_operation })
        const rc = resaDCB.get(p.reservation_id)
        if (rc) {
          encaisseParMois[rc.mois_comptable] = (encaisseParMois[rc.mois_comptable] || 0) + (p.montant || 0)
          const epc = (encProprio[rc.mois_comptable] ||= {}); epc[rc.bien?.proprietaire_id] = (epc[rc.bien?.proprietaire_id] || 0) + (p.montant || 0)
        }
      }
      continue
    }
    if (!dansCompte(compte, p.mouvement.source, p.mouvement.date_operation)) continue
    const r = resaDCB.get(p.reservation_id)
    encaisseParMois[r.mois_comptable] = (encaisseParMois[r.mois_comptable] || 0) + (p.montant || 0)
    const ep = (encProprio[r.mois_comptable] ||= {}); ep[r.bien?.proprietaire_id] = (ep[r.bien?.proprietaire_id] || 0) + (p.montant || 0)
    lieParMvt.set(p.mouvement_id, (lieParMvt.get(p.mouvement_id) || 0) + (p.montant || 0))
  }
  // Paiements reliés à des réservations d'autres mois (antérieurs au suivi) : pour ne pas les
  // compter comme « non rapprochés »
  // Réservations annulées / refusées de la période : leurs encaissements et remboursements
  // restent au séquestre (net : frais d'annulation retenus > 0, frais Stripe perdus < 0)
  const resaAnnulee = new Map(reservations.filter(exclue).map(r => [r.id, r]))
  const annuleesLiens = []
  // Réservations d'une AUTRE agence encaissées sur ce séquestre (résas directes Lauïan payées sur le
  // Stripe DCB via destinationcotebasque.com jusqu'au 25/09/2026 : 9 151,00 € net) — argent du
  // séquestre Lauïan, à lui reverser
  const autreAgenceLiens = []
  const mvtIds = mvts.map(m => m.id)
  for (let i = 0; i < mvtIds.length; i += 200) {
    const { data } = await supabase.from('reservation_paiement').select('mouvement_id, montant, reservation_id, reservation:reservation_id(code, mois_comptable, final_status, bien:bien_id(agence))').in('mouvement_id', mvtIds.slice(i, i + 200))
    for (const l of data || []) if (!resaDCB.has(l.reservation_id)) {
      lieParMvt.set(l.mouvement_id, (lieParMvt.get(l.mouvement_id) || 0) + (l.montant || 0))
      if (resaAnnulee.has(l.reservation_id)) annuleesLiens.push({ ...l, code: resaAnnulee.get(l.reservation_id).code })
      const ag = l.reservation?.bien?.agence
      const mvtL = mvts.find(m => m.id === l.mouvement_id)
      if ((!ag || ag === agence) && l.reservation?.mois_comptable && l.reservation.mois_comptable < MOIS_DEBUT_ && mvtL && mvtL.date_operation >= DEBUT_ && dansCompte(compte, mvtL.source, mvtL.date_operation))
        encaisseAnterieurApres += l.montant || 0
      if (ag && ag !== agence) {
        const mvt = mvts.find(m => m.id === l.mouvement_id)
        if (mvt && mvt.date_operation >= DEBUT_) autreAgenceLiens.push({ agence: ag, code: l.reservation.code, montant: l.montant || 0, date: mvt.date_operation })
      }
    }
  }

  // Nos résas ANNULÉES payées / remboursées sur le séquestre d'une autre agence (ALTHEA HOST-5EOGB8 :
  // −23,81 € de frais Stripe perdus, remboursés par le Stripe DCB) : font partie de ce que l'autre agence
  // nous reverse (net) ET de la poche « annulées » (frais perdus à notre charge)
  const annuleesIds = [...resaAnnulee.keys()]
  for (let i = 0; i < annuleesIds.length; i += 200) {
    const { data } = await supabase.from('reservation_paiement').select('reservation_id, montant, mouvement:mouvement_id(date_operation, agence)').in('reservation_id', annuleesIds.slice(i, i + 200))
    for (const l of data || []) if (l.mouvement?.agence && l.mouvement.agence !== agence && l.mouvement.date_operation >= DEBUT_ && l.mouvement.date_operation <= date) {
      creanceAutreAgence.push({ agence: l.mouvement.agence, reservation_id: l.reservation_id, montant: l.montant || 0, date: l.mouvement.date_operation })
      annuleesLiens.push({ ...l, code: resaAnnulee.get(l.reservation_id).code })
    }
  }

  // ── Classement des mouvements ─────────────────────────────────────────────
  // Sortie rattachée à une réservation (remboursement voyageur prélevé par Stripe…) : déjà
  // déduite de l'encaissé de la résa (paiement négatif) — ni sortie à identifier, ni double compte
  const sorties = mvts.filter(m => m.debit > 0).map(m => ({ ...m, ...(lieParMvt.has(m.id) ? { type: 'lie_resa', mois: moisDe(m.date_operation) } : forcer(m, classerSortie(m, ctx), 'sortie')) }))
    .map(s => s.tiers_id && alias.has(s.tiers_id) ? { ...s, tiers_id: alias.get(s.tiers_id) } : s)
  const entrees = mvts.filter(m => m.credit > 0)
  const transits = apparierTransits(entrees.filter(e => !lieParMvt.has(e.id)), sorties.filter(s => s.type === 'inter_agence' || s.type === 'autre'))
  const transitIds = new Set(transits.flatMap(p => [p.entree.id, p.sortie.id]))
  // Versements Airbnb qui ne sont pas des séjours (copie Hospitable payout_hospitable.reference) :
  // « Resolution Payout: AirCover damage reimbursement … » / « Misc Credit: Host Rewards … »
  const { data: payoutsSpeciaux } = await supabase.from('payout_hospitable').select('amount, date_payout, platform_id, reference')
    .eq('platform', 'airbnb').or('reference.ilike.Resolution Payout%,reference.ilike.Misc Credit%').gte('date_payout', DEBUT_)
  // Le montant de la résolution est dans le libellé « (11.07€) » : Airbnb la verse souvent DANS un
  // payout de séjours (07/08/2026 : 594,96 € = séjours 583,89 € + AirCover 11,07 €) — amount = total
  const montantRef = p => { const m = (p.reference || '').match(/\(([\d.,]+)\s*€\)\s*$/); return m ? Math.round(parseFloat(m[1].replace(',', '.')) * 100) : p.amount }
  const payoutSpecial = e => (payoutsSpeciaux || []).find(p => (Math.abs((e.montant ?? e.credit) - p.amount) <= 2 || Math.abs((e.montant ?? e.credit) - montantRef(p)) <= 2) &&
    Math.abs(Date.parse(e.date_operation) - Date.parse(p.date_payout)) <= 5 * 86400000)
  // Paiements Stripe « extra » (sans code de réservation : bouquet, lit bébé, départ tardif, facture
  // de service…) = services DCB (règle Oïhan 25/09/2026) — facturés au voyageur dans Evoliz
  const { data: lignesExtra } = await supabase.from('stripe_payout_line').select('mouvement_id, montant_net, guest_name, description').eq('type_ligne', 'extra').is('reservation_code', null)
  const extrasParMvt = new Map()
  for (const l of lignesExtra || []) { const x = extrasParMvt.get(l.mouvement_id) || { montant: 0, qui: [] }; x.montant += l.montant_net; x.qui.push(`${l.guest_name || '?'} ${(l.montant_net / 100).toFixed(2)} €${l.description ? ` (${l.description})` : ''}`); extrasParMvt.set(l.mouvement_id, x) }
  const extraStripe = (e, montant) => { const x = extrasParMvt.get(e.id); return x && Math.abs(x.montant - montant) <= 100 ? x : null }
  const horsMois = { extra_voyageur: [], aircover: [], prime_plateforme: [], remboursement_debours: [], paiement_facture: [], frais_stripe_rembourses: [], remise_frais_bancaires: [], plateforme_non_rapprochee: [], non_affecte: [], inter_agence: [], retour_dcb: [], reprise_ancien_sequestre: [] }
  for (const e of entrees) {
    if (transitIds.has(e.id) || e.date_operation < DEBUT_) continue
    const lie = lieParMvt.get(e.id) || 0
    if (lie) {
      const reste = e.credit - lie
      // Stripe verse net de ses frais : reste négatif = frais Stripe retenus sur l'encaissement
      if (reste < -100) horsMois.frais_stripe_rembourses.push({ ...e, montant: reste, raison: 'frais Stripe retenus (encaissement net)' })
      else if (reste > 100) {
        const sp = payoutSpecial({ ...e, montant: reste })
        const ex = !sp && extraStripe(e, reste)
        if (ex) horsMois.extra_voyageur.push({ ...e, montant: reste, raison: `extra voyageur Stripe : ${ex.qui.join(', ')}` })
        else if (sp) horsMois[/host rewards|misc credit/i.test(sp.reference) ? 'prime_plateforme' : 'aircover'].push({ ...e, montant: reste, raison: sp.reference })
        else horsMois.plateforme_non_rapprochee.push({ ...e, montant: reste, raison: 'part du virement non reliée à une réservation' })
      }
      continue
    }
    let c = forcer(e, classerEntree(e, facturesMontants, ctx), 'entree')
    if (c.type === 'plateforme_non_rapprochee' && c.regle === 'auto' && extraStripe(e, e.credit)) {
      c = { ...c, type: 'extra_voyageur', raison: `extra voyageur Stripe : ${extraStripe(e, e.credit).qui.join(', ')}` }
    }
    if (c.type === 'plateforme_non_rapprochee' && c.regle === 'auto') {
      const sp = payoutSpecial(e)
      if (sp) c = { ...c, type: /host rewards|misc credit/i.test(sp.reference) ? 'prime_plateforme' : 'aircover', raison: sp.reference }
    }
    ;(horsMois[c.type] || horsMois.non_affecte).push({ ...e, ...c, montant: e.credit })
  }
  const sortiesMois = (types, mois) => sorties.filter(s => !transitIds.has(s.id) && types.includes(s.type) && s.mois === mois)

  // ── Mois facturés ─────────────────────────────────────────────────────────
  const honoraires = factures.filter(f => f.type_facture === 'honoraires' && f.statut !== 'calcul_en_cours')
  // Tous les mois du suivi jusqu'au dernier mois facturé — y compris ceux sans facture dans l'app
  // (janvier-février 2026 : factures faites à la main par Laura dans Evoliz) : le dû propriétaire
  // y est calculé en live (règle « bien sans facture »)
  const moisAvecFacture = [...new Set(honoraires.filter(f => f.mois >= MOIS_DEBUT_ && f.statut !== 'brouillon').map(f => f.mois))].filter(m => m < moisCourant).sort()
  const dernierFacture = moisAvecFacture[moisAvecFacture.length - 1] || moisPlus(MOIS_DEBUT_, -1)
  const moisFactures = []
  for (let m = MOIS_DEBUT_; m <= dernierFacture; m = moisPlus(m, 1)) moisFactures.push(m)

  // « Régularisation virement MM/AAAA » (mode remboursement) : complément d'un virement trop court
  // du mois d'origine — la dette est déjà dans la facture d'origine. Dans la facture où elle est
  // réglée, ce n'est PAS une nouvelle dette : on la retire du dû de ce mois et on la compte comme
  // payée pour le mois d'origine (MUNDUZ / M-MAITE : taxe de séjour de juin oubliée, versée en août).
  const { data: regulsVirement } = await supabase.from('frais_proprietaire')
    .select('libelle, montant_ttc, mois_facturation, statut, bien_id, bien:bien_id!inner(agence, proprietaire_id, groupe_facturation)')
    .eq('bien.agence', agence).eq('mode_traitement', 'remboursement').neq('statut', 'brouillon').ilike('libelle', 'Régularisation virement %')

  // Composition des remises groupées (« REM VIR SEPA ») : fichiers générés par l'app (proprios_lc)
  // ou PDF « Détail Remise » de la banque importés (detail_remise_ce, scripts/import-detail-remise.mjs)
  const { data: compoRemises } = await supabase.from('sct_export').select('mois, type_export, total_cts, lignes').eq('agence', agence)
  const factureProprio = new Map(factures.map(f => [f.id, f.proprietaire_id]))
  // Remises réellement débitées à la date du justificatif (sorties ≤ date) : une facture n'est « versée »
  // que si sa remise est passée — sinon, recalculé à une date passée (clôture de juillet au 31/07), une
  // régularisation réglée dans la remise du 07/09 comptait déjà comme versée (+1 209,78 € d'écart fantôme)
  const totauxRemisesPassees = new Set(sorties.filter(x => x.type === 'reversement_groupe').map(x => x.debit))
  const facturesVersees = new Set((compoRemises || []).filter(c => totauxRemisesPassees.has(c.total_cts)).flatMap(c => (c.lignes || []).map(l => l.cle)).filter(Boolean))

  // La régularisation n'est comptée payée pour le mois d'origine QUE si la facture qui la porte a
  // réellement été versée (ligne de remise, ou virement individuel au propriétaire ce mois-là).
  // Avant : comptée payée d'office → LALANDE/BDX 70,60 € (facture d'août sans séjour, jamais versée)
  // apparaissait réglée alors que rien n'était parti (25/09/2026).
  const regulVir = (regulsVirement || []).map(f => {
    const m = f.libelle.match(/Régularisation virement (\d{2})\/(\d{4})/)
    if (!m) return null
    const fac = factures.find(x => x.type_facture === 'honoraires' && x.mois === f.mois_facturation &&
      (x.bien_id === f.bien_id || (!x.bien_id && f.bien?.groupe_facturation && x.proprietaire_id === f.bien?.proprietaire_id)))
    const virIndiv = sorties.some(s => ['reversement', 'reversement_hors_facture'].includes(s.type) && s.mois === f.mois_facturation && s.tiers_id === f.bien?.proprietaire_id)
    const versee = !!fac && (facturesVersees.has(fac.id) || virIndiv)
    return { ...f, mois_origine: `${m[2]}-${m[1]}`, versee }
  }).filter(Boolean)
  const regulsNonVersees = regulVir.filter(f => !f.versee && f.mois_facturation < moisPlus(new Date().toISOString().slice(0, 7), 0))
  // Symétrique : « Régularisation virement MM/AAAA » retenue sur le loyer (deduire_loyer) = récupération
  // d'un virement TROP LONG du mois d'origine (juin 2026 : virements calculés sur le brut, débours non
  // déduits — AGUERRE, CHEVALIER, BURGY, Waldau). Comptée comme remboursée au mois d'origine, et hors
  // part DCB du mois où elle est retenue (ce n'est pas un frais encaissé par l'agence). Retenue
  // non déduite mais réglée via la demande de débours (ALAUX/PANORAMA 15 €) : idem.
  const { data: retenuesRegul } = await supabase.from('frais_proprietaire')
    .select('id, libelle, montant_ttc, montant_deduit_loy, mois_facturation, bien_id, bien:bien_id!inner(agence, proprietaire_id)')
    .eq('bien.agence', agence).in('mode_traitement', ['deduire_loyer', 'facturer_et_deduire']).neq('statut', 'brouillon').ilike('libelle', 'Régularisation virement %')
  const retRegul = (retenuesRegul || []).map(f => {
    const m = f.libelle.match(/Régularisation virement (\d{2})\/(\d{4})/)
    if (!m) return null
    const debRecu = factures.some(x => x.type_facture === 'debours' && x.bien_id === f.bien_id && x.mois === f.mois_facturation && ['remboursement_recu', 'payee'].includes(x.statut)
      && (!x.date_paiement || x.date_paiement <= date))
    // La retenue n'est effective qu'une fois le reversement du mois de facturation versé (à la date du calcul)
    const facR = factures.find(x => x.type_facture === 'honoraires' && x.mois === f.mois_facturation &&
      (x.bien_id === f.bien_id || (!x.bien_id && x.proprietaire_id === f.bien?.proprietaire_id)))
    const retenueVersee = !!facR && (facturesVersees.has(facR.id) || sorties.some(s => ['reversement', 'reversement_hors_facture'].includes(s.type) && s.mois === f.mois_facturation && s.tiers_id === f.bien?.proprietaire_id))
    const recupere = (retenueVersee ? (f.montant_deduit_loy || 0) : 0) + (debRecu ? Math.max(0, f.montant_ttc - (f.montant_deduit_loy || 0)) : 0)
    return recupere ? { ...f, mois_origine: `${m[2]}-${m[1]}`, recupere } : null
  }).filter(Boolean)
  const idsRetRegul = new Set(retRegul.map(f => f.id))

  const { data: relevesProprio } = await supabase.from('sequestre_releve_proprio').select('mois, bien_id, montant').eq('agence', agence)
  const parMois = []
  for (const mois of moisFactures) {
    const encaisse = encaisseParMois[mois] || 0
    // Reversement hors facture (réaffectation manuelle) : loyer dû au propriétaire que la facture
    // ne porte pas (ITS juillet-août 2026 : ventilé sans VIRProprio, reversé à la main) — dû ET payé
    const horsFacture = sortiesMois(['reversement_hors_facture'], mois)
    const proprioDu = sum(honoraires.filter(f => f.mois === mois), f => f.montant_reversement) + sum(horsFacture, s => s.debit)
    const proprioSorties = sortiesMois(['reversement_groupe', 'reversement', 'reversement_hors_facture'], mois)
    const proprioPaye = sum(proprioSorties, s => s.debit) + sum(regulVir.filter(f => f.versee && f.mois_origine === mois), f => f.montant_ttc)
      - sum(regulVir.filter(f => f.versee && f.mois_facturation === mois), f => f.montant_ttc)
      - sum(retRegul.filter(f => f.mois_origine === mois), f => f.recupere)
      + sum(retRegul.filter(f => f.mois_facturation === mois), f => f.recupere)
    const { data: missions } = await supabase.from('mission_menage').select('montant, impute_salaire, ae:ae_id!inner(type), bien:bien_id!inner(id, agence, proprietaire_id, skip_facturation, mode_encaissement)')
      .eq('mois', mois).eq('statut', 'valide').eq('bien.agence', agence).eq('ae.type', 'ae')
    const { data: prestas } = await supabase.from('prestation_hors_forfait').select('montant, impute_salaire, ae:ae_id!inner(type), bien:bien_id!inner(id, agence, proprietaire_id, skip_facturation, mode_encaissement)')
      .eq('mois', mois).eq('statut', 'valide').eq('bien.agence', agence).eq('ae.type', 'ae')
    const aeDu = sum((missions || []).filter(x => !x.impute_salaire), x => x.montant) + sum((prestas || []).filter(x => !x.impute_salaire), x => x.montant)
    const aePaye = sum(sortiesMois(['paiement_ae'], mois), s => s.debit)
    const transferts = sortiesMois(['transfert_dcb'], mois)
    // Retours courant → séquestre d'un virement DCB en trop : réduisent ce que DCB a déjà pris
    const retours = horsMois.retour_dcb.filter(e => e.mois === mois)
    const dcbPaye = sum(transferts, s => s.debit) - sum(retours, e => e.credit)
    // Part DCB théorique : page Comptabilité (TOTAL DCB − hors séquestre) + frais retenus
    const compta = await buildComptaMensuelle(mois)
    const t = compta.totals, hs = t.hors_sequestre || {}
    const virable = (t.hon_ttc - (hs.hon_ttc || 0)) + (t.fmen_ttc - (hs.fmen_ttc || 0)) + (t.com_ttc - (hs.com_ttc || 0))
    const { data: fraisTous } = await supabase.from('frais_proprietaire').select('id, montant_deduit_loy, bien:bien_id!inner(agence, proprietaire_id)')
      .eq('bien.agence', agence).eq('mois_facturation', mois).in('mode_traitement', ['deduire_loyer', 'facturer_et_deduire'])
    const frais = (fraisTous || []).filter(f => !idsRetRegul.has(f.id))
    // Bien sans facture d'honoraires ce mois-là (LAGREOU/ASKIDA juin 2026 : bien perso du gérant,
    // aucune facture générée) : le reversement reste dû au propriétaire — compté au calcul live
    // Relevé mensuel du propriétaire (sequestre_releve_proprio, migration 281) : prime sur le recalcul
    // live pour les mois sans facture dans l'app (janv-mars 2026 : factures manuelles Evoliz). Un relevé
    // négatif (propriétaire débiteur) = rien à reverser, la dette passe par la facture de débours.
    const releveBien = new Map((relevesProprio || []).filter(x => x.mois === mois).map(x => [x.bien_id, Math.max(0, x.montant)]))
    const sansFacture = compta.rows.filter(r => !r.is_lauian_client && !r.is_lld && !r.facture_id)
      .map(r => releveBien.has(r.bien_id) ? { ...r, reversement_calcule: releveBien.get(r.bien_id), source_du: 'releve' } : r)
      .filter(r => (r.reversement_calcule || 0) > 0)
    const proprioDuSansFacture = sum(sansFacture, r => r.reversement_calcule)
    // Ménage AE des biens skip_facturation : le LOY reverse 100 % du revenu, c'est DCB qui paie l'AE
    const aeSkip = [...(missions || []), ...(prestas || [])].filter(x => !x.impute_salaire && x.bien?.skip_facturation)
    // Ménage AE des biens où le propriétaire encaisse : avancé par le séquestre, remboursé via la
    // facture de débours (poche « débours remboursés ») — normal, pas une anomalie du mois
    const aeAvance = [...(missions || []), ...(prestas || [])].filter(x => !x.impute_salaire && !x.bien?.skip_facturation && x.bien?.mode_encaissement === 'proprio')
    const dcbTheorique = virable + sum(frais || [], f => f.montant_deduit_loy) - sum(aeSkip, x => x.montant)
    const aeAvanceTotal = sum(aeAvance, x => x.montant)
    const regulRegleesIci = regulVir.filter(f => f.versee && f.mois_facturation === mois)
    // Retenue de rattrapage prélevée ce mois-ci (miroir de regulRegleesIci) : la facture du mois est
    // nette de la retenue, mais cet argent rembourse le sur-virement du mois d'origine — réintégré au
    // dû ET au payé d'ici (sinon il gonfle la part DCB du mois : compté 2×, −373,65 € le 25/09/2026)
    const retRegulIci = retRegul.filter(f => f.mois_facturation === mois)
    const proprioDuTotal = proprioDu + proprioDuSansFacture - sum(regulRegleesIci, f => f.montant_ttc) + sum(retRegulIci, f => f.recupere)
    const dcbReste = encaisse - proprioDuTotal - aeDu - dcbPaye
    // Anomalie par propriétaire : encaissé − reversement dû − AE − part DCB théorique − frais
    const parP = {}
    const add = (id, v) => { parP[id || 'sans_proprio'] = (parP[id || 'sans_proprio'] || 0) + (v || 0) }
    for (const [id, v] of Object.entries(encProprio[mois] || {})) add(id, v)
    for (const f of honoraires.filter(f => f.mois === mois)) add(f.proprietaire_id, -(f.montant_reversement || 0))
    for (const x of horsFacture) add(x.tiers_id, -x.debit)
    for (const r of sansFacture) add(r.proprietaire_id, -r.reversement_calcule)
    for (const f of regulRegleesIci) add(f.bien?.proprietaire_id, f.montant_ttc)
    for (const x of aeSkip) add(x.bien?.proprietaire_id, x.montant)
    for (const x of aeAvance) add(x.bien?.proprietaire_id, x.montant)
    for (const x of [...(missions || []), ...(prestas || [])]) if (!x.impute_salaire) add(x.bien?.proprietaire_id, -x.montant)
    for (const r of compta.rows.filter(r => !r.is_lauian_client && !r.is_lld)) {
      const h = r.hs || {}
      add(r.proprietaire_id, -((r.hon_ttc - (h.hon_ttc || 0)) + (r.fmen_ttc - (h.fmen_ttc || 0)) + (r.com_ttc - (h.com_ttc || 0))))
    }
    for (const f of frais || []) add(f.bien?.proprietaire_id, -(f.montant_deduit_loy || 0))
    // Reste dû par propriétaire : dû (factures + hors facture + sans facture − régul. réglées ici)
    // − payé (lignes des remises groupées de ce mois + virements individuels + régul. du mois d'origine)
    function resteParProprio() {
      const du = {}, paye = {}, inconnu = []
      const plus = (o, id, v) => { o[id || 'inconnu'] = (o[id || 'inconnu'] || 0) + (v || 0) }
      for (const f of honoraires.filter(f => f.mois === mois)) plus(du, f.proprietaire_id, f.montant_reversement)
      for (const x of horsFacture) plus(du, x.tiers_id, x.debit)
      for (const r of sansFacture) plus(du, r.proprietaire_id, r.reversement_calcule)
      // la régularisation réglée ce mois-ci est une dette du mois d'origine : retirée du dû ET du
      // payé d'ici (elle est comptée payée pour le mois d'origine)
      for (const f of regulRegleesIci) { plus(du, f.bien?.proprietaire_id, -f.montant_ttc); plus(paye, f.bien?.proprietaire_id, -f.montant_ttc) }
      for (const f of retRegulIci) { plus(du, f.bien?.proprietaire_id, f.recupere); plus(paye, f.bien?.proprietaire_id, f.recupere) }
      for (const sRem of proprioSorties.filter(x => x.type === 'reversement_groupe')) {
        const compo = (compoRemises || []).find(c => c.mois === mois && c.total_cts === sRem.debit)
        if (!compo) { inconnu.push(sRem); continue }
        for (const l of compo.lignes || []) plus(paye, l.proprietaire_id || factureProprio.get(l.cle), l.montant_cts)
      }
      for (const x of proprioSorties.filter(x => x.type !== 'reversement_groupe')) plus(paye, x.tiers_id, x.debit)
      for (const f of regulVir.filter(f => f.versee && f.mois_origine === mois)) plus(paye, f.bien?.proprietaire_id, f.montant_ttc)
      for (const f of retRegul.filter(f => f.mois_origine === mois)) plus(paye, f.bien?.proprietaire_id, -f.recupere)
      if (inconnu.length) return { composition_manquante: inconnu.map(x => ({ date: x.date_operation, montant: x.debit })) }
      return Object.keys({ ...du, ...paye }).map(id => ({ proprietaire_id: id, nom: nomP(id), du: du[id] || 0, paye: paye[id] || 0, reste: (du[id] || 0) - (paye[id] || 0) }))
        .filter(x => Math.abs(x.reste) >= 100).sort((a, b) => b.reste - a.reste)
    }
    const nomP = id => { const p = proprietaires.find(x => x.id === id); return p ? `${p.nom}${p.prenom ? ' ' + p.prenom : ''}` : id }
    const anomaliesProprio = Object.entries(parP).filter(([, v]) => Math.abs(v) >= 5000)
      .sort((a, b) => a[1] - b[1]).map(([id, v]) => ({ proprietaire_id: id, nom: nomP(id), montant: v }))
    parMois.push({
      mois, facture: true, encaisse,
      proprietaires: { du: proprioDuTotal, du_sans_facture: proprioDuSansFacture, paye: proprioPaye, reste: proprioDuTotal - proprioPaye,
        par_proprio: resteParProprio(),
        paiements: proprioSorties.map(s => ({ date: s.date_operation, montant: s.debit, libelle: s.libelle })) },
      ae: { du: aeDu, paye: aePaye, reste: aeDu - aePaye },
      dcb: { reste: dcbReste + aeAvanceTotal, paye: dcbPaye, theorique: dcbTheorique, reste_theorique: dcbTheorique - dcbPaye,
        anomalie: (dcbReste + aeAvanceTotal) - (dcbTheorique - dcbPaye), anomalie_par_proprio: anomaliesProprio,
        anomalie_par_proprio_complet: Object.entries(parP).filter(([, v]) => Math.abs(v) >= 100).map(([id, v]) => ({ proprietaire_id: id, nom: nomP(id), montant: v })),
        debours_ae_avances: aeAvanceTotal,
        virements: [...transferts.map(s => ({ date: s.date_operation, montant: s.debit, libelle: s.libelle, sous: s.sous, note: s.note })),
          ...retours.map(e => ({ date: e.date_operation, montant: -e.credit, libelle: e.libelle, sous: e.sous, note: e.note }))] },
    })
  }

  // ── Mois non facturés : encaissé − déjà sorti ─────────────────────────────
  const moisOuverts = [...new Set([...Object.keys(encaisseParMois), ...sorties.map(s => s.mois)])]
    .filter(m => m > dernierFacture && m >= MOIS_DEBUT_).sort()
  for (const mois of moisOuverts) {
    const encaisse = encaisseParMois[mois] || 0
    const sortis = sortiesMois(['reversement', 'reversement_groupe', 'reversement_hors_facture', 'transfert_dcb', 'paiement_ae'], mois)
    const retours = horsMois.retour_dcb.filter(e => e.mois === mois)
    const sorti = sum(sortis, s => s.debit) - sum(retours, e => e.credit)
    parMois.push({ mois, facture: false, encaisse, sorti, reste: encaisse - sorti,
      sorties: sortis.map(s => ({ date: s.date_operation, montant: s.debit, libelle: s.libelle, type: s.type })) })
  }

  // ── Hors mois ─────────────────────────────────────────────────────────────
  const sortiesAutres = sorties.filter(s => !transitIds.has(s.id) && s.date_operation >= DEBUT_ && ['autre', 'remboursement_voyageur'].includes(s.type))
  // Virements vers le séquestre de l'autre agence (hors transits appariés) : soldent la poche ci-dessous
  const versAutreAgence = sorties.filter(s => !transitIds.has(s.id) && s.date_operation >= DEBUT_ && s.type === 'inter_agence')
  // Sorties attribuées à un mois antérieur au suivi (reversement de mai payé en juin…) : elles
  // soldent des dettes d'avant la période, hors justificatif.
  const sortiesAnterieures = sorties.filter(s => !transitIds.has(s.id) && s.date_operation >= DEBUT_ && s.mois < MOIS_DEBUT_ &&
    ['reversement', 'reversement_groupe', 'reversement_hors_facture', 'transfert_dcb', 'paiement_ae'].includes(s.type))
  const fraisBancaires = sum(sorties.filter(s => s.type === 'frais_bancaires' && s.date_operation >= DEBUT_), s => s.debit)
  const deboursOuverts = factures.filter(f => f.type_facture === 'debours' && ['envoye_proprio', 'envoye_evoliz', 'valide'].includes(f.statut) && f.mois >= MOIS_DEBUT_ && f.mois <= dernierFacture)
  const tot = k => sum(horsMois[k], m => m.montant)

  const facturesListe = parMois.filter(p => p.facture)
  // Argent arrivé sur le compte AVANT le 1er mois suivi (ex. payouts du 24 au 31/12/2025 pour des
  // séjours 2025, dont les propriétaires ont été payés par l'ancien compte) moins les sorties qui
  // soldent des dettes d'avant le suivi : relève de la clôture de l'exercice précédent
  // + encaissements reçus APRÈS le début du suivi pour des séjours d'un mois antérieur (EKIA
  // HMBW82NCS9, séjour du 30/12/2025 versé par Airbnb le 02/01/2026 : 971,10 € comptés nulle part)
  const encaisseAnterieur = encaisseAnterieurApres
  const avantSuivi = (compte.ouverture_solde || 0) + sum(mvts.filter(m => m.date_operation < DEBUT_), m => (m.credit || 0) - (m.debit || 0)) + encaisseAnterieur - sum(sortiesAnterieures, s => s.debit)
  const compensationsTotal = sum(compte.compensations_inter_agence || [], c => c.montant || 0)
  const poches = [
    { cle: 'proprietaires', label: 'Propriétaires — reversements restant dus', montant: sum(facturesListe, p => p.proprietaires.reste) },
    { cle: 'ae', label: 'AE — ménages et extras non encore payés', montant: sum(facturesListe, p => p.ae.reste) },
    { cle: 'dcb', label: 'DCB — part encore détenue au séquestre (mois facturés)', montant: sum(facturesListe, p => p.dcb.reste) },
    { cle: 'non_factures', label: 'Mois non facturés et séjours à venir — encaissé non encore réparti', montant: sum(parMois.filter(p => !p.facture), p => p.reste) },
    { cle: 'debours_rembourses', label: 'Débours AE (biens où le propriétaire encaisse) : remboursements reçus − ménages avancés par le séquestre', montant: tot('remboursement_debours') - sum(facturesListe, p => p.dcb.debours_ae_avances || 0) },
    { cle: 'factures_payees_sequestre', label: 'Factures d\'honoraires payées sur le séquestre (dues à DCB)', montant: tot('paiement_facture') },
    { cle: 'stripe', label: 'Virements reçus inférieurs aux paiements reliés (frais Stripe, payout partiel Airbnb, lignes Stripe manquantes) / frais Stripe remboursés par DCB', montant: tot('frais_stripe_rembourses') },
    { cle: 'frais_bancaires', label: 'Frais bancaires (nets des remises)', montant: tot('remise_frais_bancaires') - fraisBancaires },
    { cle: 'avant_suivi', label: 'Exercice antérieur : mouvements du compte avant le 1er mois suivi − sorties réglant des dettes antérieures (à solder avec la clôture annuelle)', montant: avantSuivi },
    { cle: 'reprise_ancien_sequestre', label: 'Solde repris de l\'ancien compte séquestre (changement de banque, janvier 2026) — à ventiler avec la clôture 2025', montant: tot('reprise_ancien_sequestre') },
    { cle: 'creance_autre_agence', label: 'À recevoir du séquestre d\'une autre agence (nos réservations payées sur son compte, pas encore arrivées ici)', montant: -(sum(creanceAutreAgence, x => x.montant) - sum(horsMois.inter_agence, e => e.credit || 0)) },
    { cle: 'autre_agence', label: 'Réservations d\'une autre agence encaissées sur ce séquestre − déjà reversées à son séquestre − compensations', montant: sum(autreAgenceLiens, l => l.montant) - sum(versAutreAgence, s => s.debit) - compensationsTotal },
    // Compensation inter-agences (migration 282) : ce que l'autre agence nous devait (LVH 2025 : loyers
    // d'un bien DCB versés sur le séquestre Lauïan, propriétaire payé par DCB) est retenu sur ce qu'on lui
    // reverse. Reste sur ce compte ; revient à l'agence (le propriétaire a déjà été payé en 2025).
    { cle: 'compensation_inter_agence', label: 'Récupéré par compensation sur l\'autre agence (LVH 2025 : propriétaire déjà payé par DCB) — revient à l\'agence, à solder avec la clôture 2025', montant: compensationsTotal },
    { cle: 'annulees', label: 'Réservations annulées — net encaissé − remboursé (frais d\'annulation retenus / frais perdus)', montant: sum(annuleesLiens, l => l.montant) },
    { cle: 'extra_voyageur', label: 'Extras voyageurs payés par Stripe (bouquet, lit bébé, départ tardif…) — services DCB', montant: tot('extra_voyageur') },
    { cle: 'aircover', label: 'Remboursements AirCover (dégâts) — reviennent à qui a payé la réparation', montant: tot('aircover') },
    { cle: 'prime_plateforme', label: 'Primes plateforme à l\'hôte (Airbnb Host Rewards…) — dues à l\'agence', montant: tot('prime_plateforme') },
    { cle: 'plateformes_non_rapprochees', label: 'Encaissements plateformes non reliés à une réservation', montant: tot('plateforme_non_rapprochee') },
    { cle: 'entrees_non_affectees', label: 'Autres encaissements à identifier', montant: tot('non_affecte') },
    { cle: 'sorties_non_affectees', label: 'Autres sorties à identifier', montant: -sum(sortiesAutres, s => s.debit) },
  ]
  // Sorties soldant des dettes d'avant la période (remise du 09/06 pour mai, HON/FMEN de mai…) :
  // PAS une poche — la dette qu'elles soldent n'est pas dans le justificatif, et l'argent n'est
  // plus sur le compte. Gardées en information (detail.sorties_anterieures).
  const totalSortiesAnterieures = sum(sortiesAnterieures, s => s.debit)
  const totalJustifie = sum(poches, p => p.montant)

  // Anomalies lisibles (servent aussi à l'alerte) — seuil 1 € pour les arrondis
  const eur = c => (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const anomalies = []
  for (const p of facturesListe) {
    if (p.proprietaires.reste < -100) anomalies.push({ cle: `proprio_trop_verse_${p.mois}`, mois: p.mois, montant: p.proprietaires.reste,
      message: `${p.mois} : ${eur(-p.proprietaires.reste)} reversés aux propriétaires au-delà des factures (sur-virement, ou reversement réglé hors facture)` })
    if (p.ae.reste < -100) anomalies.push({ cle: `ae_trop_paye_${p.mois}`, mois: p.mois, montant: p.ae.reste,
      message: `${p.mois} : ${eur(-p.ae.reste)} payés aux AE au-delà des missions et extras validés` })
    if (Math.abs(p.dcb.anomalie) > 100) anomalies.push({ cle: `dcb_${p.mois}`, mois: p.mois, montant: p.dcb.anomalie,
      message: (p.dcb.anomalie < 0
        ? `${p.mois} : il manque ${eur(-p.dcb.anomalie)} au séquestre par rapport à la part DCB théorique (virement DCB en trop, encaissement manquant ou débours non remboursé)`
        : `${p.mois} : ${eur(p.dcb.anomalie)} de plus que la part DCB théorique (encaissement non réparti, reversement non facturé…)`) +
        (p.dcb.anomalie_par_proprio.length ? ` — principaux : ${[...p.dcb.anomalie_par_proprio].sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant)).slice(0, 4).map(x => `${x.nom} ${eur(x.montant)}`).join(', ')}` : '') })
  }
  // Propriétaire payé au-delà de son dû sur un mois (≥ 10 €) : double paiement probable
  // (CAROSSIO/VIKY juin 2026 : taxe de séjour 28,31 € versée dans la remise du 07/09 ET à la main le 24/09)
  for (const p of facturesListe) for (const x of (Array.isArray(p.proprietaires.par_proprio) ? p.proprietaires.par_proprio : []))
    if (x.reste <= -1000 && x.nom !== 'inconnu') anomalies.push({ cle: `proprio_paye_2x_${p.mois}_${x.proprietaire_id}_${x.reste}`, mois: p.mois, montant: x.reste,
      message: `${p.mois} : ${x.nom} a reçu ${eur(-x.reste)} de plus que son dû (${eur(x.du)} dû, ${eur(x.paye)} versés) — double paiement ?` })
  // Régularisation « remboursement » d'un mois passé jamais versée (facture non finalisée / hors fichier de virements)
  for (const f of regulsNonVersees) anomalies.push({ cle: `regul_non_versee_${f.bien_id}_${f.mois_facturation}`, mois: f.mois_origine, montant: f.montant_ttc,
    message: `${eur(f.montant_ttc)} de régularisation (${f.libelle.slice(0, 80)}) prévus au reversement de ${f.mois_facturation}, jamais versés` })
  // Remboursement prévu (frais « remboursement ») dont le montant a AUSSI été viré à la main au même
  // propriétaire : ITS 11 013,39 € (régul. juillet-août mise en septembre, déjà virée le 09/09), CAROSSIO 28,31 €
  {
    const { data: rembs } = await supabase.from('frais_proprietaire')
      .select('id, bien_id, libelle, date, montant_ttc, mois_facturation, bien:bien_id!inner(agence, code, proprietaire_id)')
      .eq('bien.agence', agence).eq('mode_traitement', 'remboursement').neq('statut', 'brouillon').gte('mois_facturation', MOIS_DEBUT_)
    const manuels = sorties.filter(s => ['reversement', 'reversement_hors_facture'].includes(s.type) && s.tiers_id && !/^REM VIR/i.test(s.libelle || ''))
    // Double paiement déjà compensé par une retenue du même montant sur le même bien → plus d'alerte
    const { data: compens } = await supabase.from('frais_proprietaire').select('bien_id, montant_ttc, date, bien:bien_id!inner(agence)')
      .eq('bien.agence', agence).in('mode_traitement', ['deduire_loyer', 'facturer_et_deduire']).neq('statut', 'brouillon').gte('mois_facturation', MOIS_DEBUT_)
    for (const f of (rembs || []).filter(f => !(compens || []).some(c => c.bien_id === f.bien_id && c.montant_ttc === f.montant_ttc && c.date >= f.date))) {
      const depuis = new Date(new Date(f.date).getTime() - 10 * 86400000).toISOString().slice(0, 10)
      const siens = manuels.filter(s => s.tiers_id === f.bien.proprietaire_id && s.date_operation >= depuis)
      const egal = siens.find(s => Math.abs(s.debit - f.montant_ttc) <= 100)
      const total = sum(siens, s => s.debit)
      if (egal || (siens.length > 1 && Math.abs(total - f.montant_ttc) <= 100))
        anomalies.push({ cle: `remboursement_deja_vire_${f.id}`, mois: f.mois_facturation, montant: f.montant_ttc,
          message: `${f.bien.code} : remboursement de ${eur(f.montant_ttc)} (reversement ${f.mois_facturation}) déjà viré à la main (${(egal ? [egal] : siens).map(s => `${s.date_operation.split('-').reverse().join('/')} ${eur(s.debit)}`).join(' + ')}) — double paiement si la ligne reste active` })
    }
  }
  // Résa annulée à 0 € (rien encaissé, rien retenu) qui garde une répartition : passée à 0 € après le
  // verrouillage du mois, jamais recalculée → loyer versé au propriétaire sans aucun encaissement
  // (DUL2 HM8HQQP53E 384,44 €, PANTXIKA HMEAQXCBW8 403,80 €, juillet 2026). Règle Oïhan : annulée à
  // 0 € = aucune ligne, on n'invente pas d'argent.
  {
    const annulees0 = [...resaAnnulee.values()].filter(r => !(r.fin_revenue > 0))
    const figees = []
    for (let i = 0; i < annulees0.length; i += 200) {
      const { data } = await supabase.from('ventilation').select('reservation_id, code, montant_ttc').in('reservation_id', annulees0.slice(i, i + 200).map(r => r.id)).in('code', ['VIR', 'HON', 'FMEN', 'COM'])
      for (const v of data || []) if (v.montant_ttc) figees.push(v)
    }
    const parResa = {}
    for (const v of figees) (parResa[v.reservation_id] ||= {})[v.code] = ((parResa[v.reservation_id] || {})[v.code] || 0) + v.montant_ttc
    // Déjà rectifiée : un frais propriétaire cite le code de la résa (retenue « Rectification facture »)
    const { data: rectifs } = Object.keys(parResa).length
      ? await supabase.from('frais_proprietaire').select('libelle').neq('statut', 'brouillon').ilike('libelle', 'Rectification facture%')
      : { data: [] }
    for (const [id, c] of Object.entries(parResa)) {
      const r = resaAnnulee.get(id)
      if ((rectifs || []).some(f => f.libelle.includes(r.code))) continue
      anomalies.push({ cle: `annulee_0_ventilee_${r.code}`, mois: r.mois_comptable, montant: -(c.VIR || 0),
        message: `${r.code} (${r.mois_comptable}) annulée à 0 € mais encore répartie : ${Object.entries(c).map(([k, v]) => `${k} ${eur(v)}`).join(', ')} — loyer versé au propriétaire sans encaissement, à régulariser` })
    }
  }
  // Paiement relié à une résa annulée SANS revenu : lien presque toujours faux (HMKBNZXMPW,
  // 25/09/2026 : payout 1 065,53 € d'un autre séjour du même bien, annulation synchronisée en retard)
  const liensAnnulees = Object.values(annuleesLiens.reduce((a, l) => { (a[l.code] ||= { code: l.code, montant: 0 }).montant += l.montant || 0; return a }, {})).filter(x => x.montant > 100) // négatif = frais Stripe perdus sur une annulation remboursée : normal
  if (liensAnnulees.length) anomalies.push({ cle: `paiement_resa_annulee_${liensAnnulees.map(x => x.code).sort().join('_')}`, montant: sum(liensAnnulees, x => x.montant),
    message: `Paiement(s) relié(s) à une réservation annulée sans revenu — vérifier le rapprochement (probable mauvaise résa) : ${liensAnnulees.map(x => `${x.code} ${eur(x.montant)}`).join(', ')}` })
  // Résa encaissée nettement au-delà de son revenu : presque toujours un double rattachement
  // (HMWEBSK4Z4 BITXI 07/2026 : payée par le virement du 14/07 ET par celui du 31/07, qui était
  // en réalité celui de deux autres séjours au même total)
  // Critère : au moins deux virements différents reliés chacun pour le montant TOTAL de la résa
  // (une résolution Airbnb retenue sur un payout suivant rend légitimement un virement > revenu)
  const liensParResa = {}
  for (const p of preuves) if (p.mouvement_id && p.mouvement && p.mouvement.date_operation <= date) (liensParResa[p.reservation_id] ||= []).push(p)
  const candidatsDouble = Object.keys(liensParResa).filter(id => liensParResa[id].length >= 2)
  const encParResa = Object.fromEntries(candidatsDouble.map(id => [id, sum(liensParResa[id], p => p.montant)]))
  const revs = []
  for (let i = 0; i < candidatsDouble.length; i += 200) {
    const { data } = await supabase.from('reservation').select('id, code, fin_revenue').in('id', candidatsDouble.slice(i, i + 200))
    revs.push(...(data || []))
  }
  const surPayees = revs.filter(r => r.fin_revenue > 0 && liensParResa[r.id].filter(p => Math.abs((p.montant || 0) - r.fin_revenue) <= 100).length >= 2)
  if (surPayees.length) anomalies.push({ cle: `resa_sur_encaissee_${surPayees.map(r => r.code).sort().join('_')}`, montant: sum(surPayees, r => encParResa[r.id] - r.fin_revenue),
    message: `Réservation(s) encaissée(s) bien au-delà de leur revenu — probable double rattachement d'un virement : ${surPayees.map(r => `${r.code} reçu ${eur(encParResa[r.id])} pour ${eur(r.fin_revenue)}`).join(' ; ')}` })
  // Séjour présent dans le détail d'un virement Booking/Airbnb mais absent des réservations :
  // Hospitable ne l'expose pas toujours dans son API (Mirith Rast 6554316846, TXOMIN juillet 2026 :
  // demande Booking pré-approuvée, visible dans l'interface Hospitable, absente de l'API) → jamais
  // synchronisé, part propriétaire jamais reversée.
  const orphelins = []
  for (let i = 0; i < mvtIds.length; i += 200) {
    const lot = mvtIds.slice(i, i + 200)
    const [{ data: bk }, { data: ab }] = await Promise.all([
      supabase.from('booking_payout_line').select('booking_ref, guest_name, checkin, amount_cents').in('mouvement_id', lot),
      supabase.from('airbnb_payout_line').select('confirmation_code, guest_name, checkin, amount_cents').in('mouvement_id', lot),
    ])
    for (const l of bk || []) orphelins.push({ code: l.booking_ref, guest: l.guest_name, checkin: l.checkin, montant: l.amount_cents })
    for (const l of ab || []) if (l.confirmation_code) orphelins.push({ code: l.confirmation_code, guest: l.guest_name, checkin: l.checkin, montant: l.amount_cents })
  }
  const codesConnus = new Set()
  const codesPayout = [...new Set(orphelins.map(o => o.code))]
  for (let i = 0; i < codesPayout.length; i += 200) {
    const { data } = await supabase.from('reservation').select('code').in('code', codesPayout.slice(i, i + 200))
    for (const r of data || []) codesConnus.add(r.code)
  }
  const sejoursInconnus = orphelins.filter(o => !codesConnus.has(o.code))
  if (sejoursInconnus.length) anomalies.push({ cle: `sejour_payout_sans_resa_${sejoursInconnus.map(o => o.code).sort().join('_')}`, montant: sum(sejoursInconnus, o => o.montant),
    message: `Séjour(s) payé(s) par la plateforme mais absent(s) des réservations (non synchronisé par Hospitable — à créer, part propriétaire à reverser) : ${sejoursInconnus.map(o => `${o.code} ${o.guest || ''} arrivée ${o.checkin} ${eur(o.montant)}`).join(' ; ')}` })
  if (sum(sortiesAutres, s => s.debit) > 100) anomalies.push({ cle: 'sorties_a_identifier', montant: -sum(sortiesAutres, s => s.debit), message: `${sortiesAutres.length} sortie(s) non identifiée(s) : ${eur(sum(sortiesAutres, s => s.debit))}` })
  const soldeBanque = solde ?? (await soldeCompte(compte, date))
  // Contrôle d'IMPORT : solde de la banque ≠ relevé importé
  let ecartImport = null
  if (soldeBanque.banque) {
    const refDate = soldeBanque.banque.date || date
    const releveRef = refDate === date ? soldeBanque.montant : await soldeReleve(compte, refDate)
    ecartImport = soldeBanque.banque.montant - releveRef
    if (Math.abs(ecartImport) > 100) anomalies.push({ cle: `ecart_import_${refDate}`, montant: ecartImport,
      message: `Relevé importé pas à jour : solde banque ${eur(soldeBanque.banque.montant)} (${soldeBanque.banque.maj}) ≠ ouverture + mouvements importés ${eur(releveRef)} — mouvements pas encore importés, ou importés en double` })
  }

  // ── Grand livre des mandants : chaque mouvement attribué à un ayant droit et à un mois ──────
  const ecritures = []
  const ec = (m, ligne, montant, ayant_droit, nature, extra = {}) => ecritures.push({ agence, mouvement_id: m.id, ligne, date_operation: m.date_operation, montant,
    ayant_droit, nature, mois: extra.mois || null, tiers_id: extra.tiers_id || null, tiers_nom: extra.tiers_nom || null, regle: extra.regle || 'auto', detail: extra.detail || null })
  const nomProprio = id => { const p = proprietaires.find(x => x.id === id); return p ? `${p.nom}${p.prenom ? ' ' + p.prenom : ''}` : null }
  const nomAe = id => { const a = aes.find(x => x.id === id); return a ? `${a.prenom || ''} ${a.nom || ''}`.trim() : null }
  const typeSortie = { reversement: 'proprietaire', reversement_hors_facture: 'proprietaire', transfert_dcb: 'agence', paiement_ae: 'ae', frais_bancaires: 'banque',
    inter_agence: 'autre_agence', remboursement_voyageur: 'voyageur', lie_resa: 'voyageur', autre: 'a_affecter' }
  for (const sm of sorties.filter(x => x.date_operation >= DEBUT_)) {
    if (transitIds.has(sm.id)) { ec(sm, 0, -sm.debit, 'autre_agence', 'transit', { mois: sm.mois }); continue }
    if (sm.type === 'reversement_groupe') {
      const compo = (compoRemises || []).find(c => c.mois === sm.mois && c.total_cts === sm.debit)
      if (!compo) { ec(sm, 0, -sm.debit, 'a_affecter', 'remise_groupee_sans_detail', { mois: sm.mois, detail: { conseil: 'importer le PDF « Détail Remise » (scripts/import-detail-remise.mjs)' } }); continue }
      compo.lignes.forEach((l, i) => { const pid = l.proprietaire_id || factureProprio.get(l.cle)
        ec(sm, i, -l.montant_cts, pid ? 'proprietaire' : 'a_affecter', 'reversement', { mois: sm.mois, tiers_id: pid, tiers_nom: nomProprio(pid) || l.nom, regle: 'detail_remise' }) })
      continue
    }
    const ad = typeSortie[sm.type] || 'a_affecter'
    ec(sm, 0, -sm.debit, ad, sm.sous || sm.type, { mois: sm.mois, tiers_id: sm.tiers_id, tiers_nom: ad === 'ae' ? nomAe(sm.tiers_id) : nomProprio(sm.tiers_id), regle: sm.regle })
  }
  // AirCover (règle Oïhan 25/09/2026) : revient à qui a payé la réparation. Réparation retenue au
  // propriétaire (frais du même montant, ±60 j) → propriétaire (à lui rembourser) ; sinon DCB a
  // assumé la réparation → agence. (602 BURGY : Castorama 30 € retenu le 15/07 ↔ AirCover 30 € du 14/07)
  const { data: fraisRepar } = await supabase.from('frais_proprietaire').select('montant_ttc, date, libelle, bien:bien_id!inner(agence, code, proprietaire_id)')
    .eq('bien.agence', agence).in('mode_traitement', ['deduire_loyer', 'facturer_direct', 'facturer_et_deduire']).neq('statut', 'brouillon').gte('date', DEBUT_)
  for (const e of horsMois.aircover) {
    const t = Date.parse(e.date_operation)
    const f = (fraisRepar || []).find(f => Math.abs(f.montant_ttc - e.montant) <= 100 && Math.abs(Date.parse(f.date) - t) <= 60 * 86400000 && !/aircover|compt[ée] 2/i.test(f.libelle))
    e.aircover_ayant_droit = f ? 'proprietaire' : 'agence'
    e.tiers_id = f?.bien?.proprietaire_id
    e.raison = `${e.raison || 'AirCover'} → ${f ? `propriétaire ${f.bien.code} (réparation « ${f.libelle.slice(0, 60)} » retenue le ${f.date.split('-').reverse().join('/')})` : 'DCB (aucune réparation retenue au propriétaire)'}`
  }
  const typeEntree = { extra_voyageur: 'agence', aircover: 'a_affecter', prime_plateforme: 'agence', remboursement_debours: 'proprietaire', paiement_facture: 'agence', frais_stripe_rembourses: 'agence', retour_dcb: 'agence', remise_frais_bancaires: 'banque',
    inter_agence: 'autre_agence', reprise_ancien_sequestre: 'reprise', plateforme_non_rapprochee: 'a_affecter', non_affecte: 'a_affecter' }
  const dejaEc = new Set()
  for (const [k, lst] of Object.entries(horsMois)) for (const e of lst) {
    const partielle = e.raison && lieParMvt.has(e.id)
    // payout inférieur aux paiements reliés : l'écriture « réservations » est plafonnée au montant
    // reçu plus bas — ne pas ajouter la différence une 2e fois
    if (partielle && e.montant < 0) continue
    ec(e, partielle ? 1 : 0, e.montant, e.aircover_ayant_droit || typeEntree[k] || 'a_affecter', k, { mois: e.mois || moisDe(e.date_operation), tiers_id: e.tiers_id, tiers_nom: e.tiers_id ? nomProprio(e.tiers_id) : null, regle: e.regle || 'auto', detail: e.raison ? { raison: e.raison } : null })
    if (!partielle) dejaEc.add(e.id)
  }
  for (const e of entrees.filter(x => x.date_operation >= DEBUT_ && !dejaEc.has(x.id))) {
    if (transitIds.has(e.id)) { ec(e, 0, e.credit, 'autre_agence', 'transit'); continue }
    const lie = lieParMvt.get(e.id) || 0
    if (lie) ec(e, 0, Math.min(e.credit, lie), 'reservations', 'encaissement_resa', { regle: 'rapprochement', mois: moisDe(e.date_operation) })
  }
  // Alertes du grand livre : remise groupée sans composition, mouvements en attente d'affectation
  const sansDetail = ecritures.filter(x => x.nature === 'remise_groupee_sans_detail')
  if (sansDetail.length) anomalies.push({ cle: `remise_sans_detail_${sansDetail.map(x => x.date_operation).join('_')}`, montant: sum(sansDetail, x => x.montant),
    message: `Remise(s) groupée(s) sans détail des bénéficiaires : ${sansDetail.map(x => `${x.date_operation} ${eur(-x.montant)}`).join(', ')} — importer le PDF « Détail Remise » de la banque (scripts/import-detail-remise.mjs)` })
  const limite = new Date(Date.parse(date) - 2 * 86400000).toISOString().slice(0, 10)
  const enAttente = ecritures.filter(x => x.ayant_droit === 'a_affecter' && x.date_operation <= limite && x.nature !== 'remise_groupee_sans_detail')
  if (enAttente.length) anomalies.push({ cle: `a_affecter_${enAttente.length}_${enAttente[0].date_operation}`, montant: sum(enAttente, x => x.montant),
    message: `${enAttente.length} mouvement(s) du séquestre sans ayant droit depuis plus de 48 h (${eur(sum(enAttente, x => x.montant))}) — page Séquestre, boîte « À affecter »` })

  const lignes = arr => arr.map(m => ({ date: m.date_operation, montant: m.montant ?? m.debit ?? m.credit, libelle: (m.libelle || '').replace(/\n/g, ' ').slice(0, 120), raison: m.raison }))

  return {
    agence, date, mois_debut: MOIS_DEBUT_,
    solde_banque: soldeBanque,
    total_justifie: totalJustifie,
    ecart: soldeBanque.montant - totalJustifie,
    ecart_import: ecartImport,
    poches, par_mois: parMois, anomalies, sorties_anterieures_total: totalSortiesAnterieures, ecritures,
    detail: {
      debours_non_rembourses: deboursOuverts.map(f => ({ mois: f.mois, bien: f.bien?.code, montant: f.total_ttc, statut: f.statut })),
      remboursements_debours: lignes(horsMois.remboursement_debours),
      factures_payees_sequestre: lignes(horsMois.paiement_facture),
      plateformes_non_rapprochees: lignes(horsMois.plateforme_non_rapprochee),
      extras_voyageurs: lignes(horsMois.extra_voyageur), aircover: lignes(horsMois.aircover), primes_plateforme: lignes(horsMois.prime_plateforme),
      entrees_a_identifier: lignes([...horsMois.non_affecte, ...horsMois.inter_agence]),
      sorties_a_identifier: lignes(sortiesAutres),
      sorties_anterieures: lignes(sortiesAnterieures),
      annulees: Object.values(annuleesLiens.reduce((a, l) => { (a[l.code] ||= { code: l.code, montant: 0 }).montant += l.montant || 0; return a }, {})),
      retours_dcb: lignes(horsMois.retour_dcb),
      autre_agence: { encaisse: autreAgenceLiens, reverse: lignes(versAutreAgence) },
      stripe: lignes(horsMois.frais_stripe_rembourses),
      reaffectations: [...affecte.values()],
      transits: transits.map(p => ({ entree: p.entree.libelle?.slice(0, 60), sortie: p.sortie.libelle?.slice(0, 60), montant: p.entree.credit, date: p.entree.date_operation })),
    },
  }
}
