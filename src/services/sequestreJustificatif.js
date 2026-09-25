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
export const MOIS_DEBUT = '2026-06'
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

export async function soldeBancaireSequestre() {
  const { data, error } = await supabase.functions.invoke('pennylane-proxy', { body: { action: 'listBankAccounts', payload: {} } })
  if (error) throw new Error(`Pennylane : ${error.message}`)
  const compte = (data?.data?.items || []).find(a => String(a.id) === PENNYLANE_SEQUESTRE_LC)
  if (!compte) throw new Error('Compte séquestre location saisonnière introuvable dans Pennylane')
  return { montant: Math.round(Number(compte.balance) * 100), maj: compte.updated_at }
}

export async function justifierSequestre(agence = 'dcb', { date = new Date().toISOString().slice(0, 10), solde = null, moisDebut = MOIS_DEBUT } = {}) {
  const moisCourant = moisDe(date)
  const MOIS_DEBUT_ = moisDebut, DEBUT_ = `${moisDebut}-01`
  const [aes, proprietaires, mvts, factures, reservations, affectations] = await Promise.all([
    toutes(() => supabase.from('auto_entrepreneur').select('id, nom, prenom, type')),
    toutes(() => supabase.from('proprietaire').select('id, nom, prenom').eq('agence', agence)),
    toutes(() => supabase.from('mouvement_bancaire')
      .select('id, date_operation, libelle, detail, credit, debit, canal, statut_matching, source')
      .eq('agence', agence).lte('date_operation', date)
      // Avant la bascule : relevé CE importé en deux sources complémentaires (« CaisseEpargne » +
      // « csv », surtout les crédits de janvier-mars) — recoupé ligne à ligne avec le relevé complet
      // du compte le 25/09/2026 (630 opérations, 0 manquante après complément, doublons en 'ignore')
      .or(`and(source.eq.${SOURCE_SEQUESTRE_LC},date_operation.gte.${BASCULE_PENNYLANE}),and(source.in.(CaisseEpargne,csv),date_operation.lt.${BASCULE_PENNYLANE})`)
      .neq('statut_matching', 'ignore').order('date_operation')),
    toutes(() => supabase.from('facture_evoliz')
      .select('id, mois, type_facture, statut, total_ttc, total_ttc_evoliz, montant_reversement, bien_id, proprietaire_id, numero_facture, bien:bien_id(code), proprietaire:proprietaire_id(nom)')
      .eq('agence', agence).gte('mois', MOIS_DEBUT_ < '2026-01' ? MOIS_DEBUT_ : '2026-01')),
    toutes(() => supabase.from('reservation')
      .select('id, code, mois_comptable, platform, final_status, fin_revenue, bien:bien_id!inner(agence, mode_encaissement, proprietaire_id)')
      .eq('bien.agence', agence).gte('mois_comptable', MOIS_DEBUT_)),
    toutes(() => supabase.from('sequestre_affectation').select('mouvement_id, type, sous, mois, note')),
  ])
  // Réaffectations manuelles (migration 277) : priment sur le classement par libellé
  const affecte = new Map(affectations.map(a => [a.mouvement_id, a]))
  const forcer = (m, c) => {
    const a = affecte.get(m.id)
    return a ? { ...c, type: a.type, sous: a.sous ?? c.sous, mois: a.mois ?? c.mois, note: a.note } : c
  }
  const ctx = { aes: aes.filter(a => a.type === 'ae'), proprietaires }
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
      .select('reservation_id, mouvement_id, montant, mouvement:mouvement_id(date_operation, source)')
      .in('reservation_id', resaIds.slice(i, i + 200))
    if (ePrv) throw ePrv
    preuves.push(...(data || []))
  }
  const encaisseParMois = {}
  const encProprio = {} // mois → proprietaire_id → encaissé (détail des anomalies)
  const lieParMvt = new Map()
  for (const p of preuves || []) {
    if (!p.mouvement_id || !p.mouvement || p.mouvement.date_operation > date) continue
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
  const mvtIds = mvts.map(m => m.id)
  for (let i = 0; i < mvtIds.length; i += 200) {
    const { data } = await supabase.from('reservation_paiement').select('mouvement_id, montant, reservation_id').in('mouvement_id', mvtIds.slice(i, i + 200))
    for (const l of data || []) if (!resaDCB.has(l.reservation_id)) {
      lieParMvt.set(l.mouvement_id, (lieParMvt.get(l.mouvement_id) || 0) + (l.montant || 0))
      if (resaAnnulee.has(l.reservation_id)) annuleesLiens.push({ ...l, code: resaAnnulee.get(l.reservation_id).code })
    }
  }

  // ── Classement des mouvements ─────────────────────────────────────────────
  // Sortie rattachée à une réservation (remboursement voyageur prélevé par Stripe…) : déjà
  // déduite de l'encaissé de la résa (paiement négatif) — ni sortie à identifier, ni double compte
  const sorties = mvts.filter(m => m.debit > 0).map(m => ({ ...m, ...(lieParMvt.has(m.id) ? { type: 'lie_resa', mois: moisDe(m.date_operation) } : forcer(m, classerSortie(m, ctx))) }))
  const entrees = mvts.filter(m => m.credit > 0)
  const transits = apparierTransits(entrees.filter(e => !lieParMvt.has(e.id)), sorties.filter(s => s.type === 'inter_agence' || s.type === 'autre'))
  const transitIds = new Set(transits.flatMap(p => [p.entree.id, p.sortie.id]))
  const horsMois = { remboursement_debours: [], paiement_facture: [], frais_stripe_rembourses: [], remise_frais_bancaires: [], plateforme_non_rapprochee: [], non_affecte: [], inter_agence: [], retour_dcb: [] }
  for (const e of entrees) {
    if (transitIds.has(e.id) || e.date_operation < DEBUT_) continue
    const lie = lieParMvt.get(e.id) || 0
    if (lie) {
      const reste = e.credit - lie
      // Stripe verse net de ses frais : reste négatif = frais Stripe retenus sur l'encaissement
      if (reste < -100) horsMois.frais_stripe_rembourses.push({ ...e, montant: reste, raison: 'frais Stripe retenus (encaissement net)' })
      else if (reste > 100) horsMois.plateforme_non_rapprochee.push({ ...e, montant: reste, raison: 'part du virement non reliée à une réservation' })
      continue
    }
    const c = forcer(e, classerEntree(e, facturesMontants))
    ;(horsMois[c.type] || horsMois.non_affecte).push({ ...e, ...c, montant: e.credit })
  }
  const sortiesMois = (types, mois) => sorties.filter(s => !transitIds.has(s.id) && types.includes(s.type) && s.mois === mois)

  // ── Mois facturés ─────────────────────────────────────────────────────────
  const honoraires = factures.filter(f => f.type_facture === 'honoraires' && f.statut !== 'calcul_en_cours')
  const moisFactures = [...new Set(honoraires.filter(f => f.mois >= MOIS_DEBUT_ && f.statut !== 'brouillon').map(f => f.mois))].filter(m => m < moisCourant).sort()
  const dernierFacture = moisFactures[moisFactures.length - 1] || moisPlus(MOIS_DEBUT_, -1)

  // « Régularisation virement MM/AAAA » (mode remboursement) : complément d'un virement trop court
  // du mois d'origine — la dette est déjà dans la facture d'origine. Dans la facture où elle est
  // réglée, ce n'est PAS une nouvelle dette : on la retire du dû de ce mois et on la compte comme
  // payée pour le mois d'origine (MUNDUZ / M-MAITE : taxe de séjour de juin oubliée, versée en août).
  const { data: regulsVirement } = await supabase.from('frais_proprietaire')
    .select('libelle, montant_ttc, mois_facturation, bien:bien_id!inner(agence, proprietaire_id)')
    .eq('bien.agence', agence).eq('mode_traitement', 'remboursement').ilike('libelle', 'Régularisation virement %')
  const regulVir = (regulsVirement || []).map(f => {
    const m = f.libelle.match(/Régularisation virement (\d{2})\/(\d{4})/)
    return m ? { ...f, mois_origine: `${m[2]}-${m[1]}` } : null
  }).filter(Boolean)

  const parMois = []
  for (const mois of moisFactures) {
    const encaisse = encaisseParMois[mois] || 0
    // Reversement hors facture (réaffectation manuelle) : loyer dû au propriétaire que la facture
    // ne porte pas (ITS juillet-août 2026 : ventilé sans VIRProprio, reversé à la main) — dû ET payé
    const horsFacture = sortiesMois(['reversement_hors_facture'], mois)
    const proprioDu = sum(honoraires.filter(f => f.mois === mois), f => f.montant_reversement) + sum(horsFacture, s => s.debit)
    const proprioSorties = sortiesMois(['reversement_groupe', 'reversement', 'reversement_hors_facture'], mois)
    const proprioPaye = sum(proprioSorties, s => s.debit) + sum(regulVir.filter(f => f.mois_origine === mois), f => f.montant_ttc)
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
    const { data: frais } = await supabase.from('frais_proprietaire').select('montant_deduit_loy, bien:bien_id!inner(agence, proprietaire_id)')
      .eq('bien.agence', agence).eq('mois_facturation', mois).in('mode_traitement', ['deduire_loyer', 'facturer_et_deduire'])
    // Bien sans facture d'honoraires ce mois-là (LAGREOU/ASKIDA juin 2026 : bien perso du gérant,
    // aucune facture générée) : le reversement reste dû au propriétaire — compté au calcul live
    const sansFacture = compta.rows.filter(r => !r.is_lauian_client && !r.is_lld && !r.facture_id && (r.reversement_calcule || 0) > 0)
    const proprioDuSansFacture = sum(sansFacture, r => r.reversement_calcule)
    // Ménage AE des biens skip_facturation : le LOY reverse 100 % du revenu, c'est DCB qui paie l'AE
    const aeSkip = [...(missions || []), ...(prestas || [])].filter(x => !x.impute_salaire && x.bien?.skip_facturation)
    // Ménage AE des biens où le propriétaire encaisse : avancé par le séquestre, remboursé via la
    // facture de débours (poche « débours remboursés ») — normal, pas une anomalie du mois
    const aeAvance = [...(missions || []), ...(prestas || [])].filter(x => !x.impute_salaire && !x.bien?.skip_facturation && x.bien?.mode_encaissement === 'proprio')
    const dcbTheorique = virable + sum(frais || [], f => f.montant_deduit_loy) - sum(aeSkip, x => x.montant)
    const aeAvanceTotal = sum(aeAvance, x => x.montant)
    const regulRegleesIci = regulVir.filter(f => f.mois_facturation === mois)
    const proprioDuTotal = proprioDu + proprioDuSansFacture - sum(regulRegleesIci, f => f.montant_ttc)
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
    const nomP = id => { const p = proprietaires.find(x => x.id === id); return p ? `${p.nom}${p.prenom ? ' ' + p.prenom : ''}` : id }
    const anomaliesProprio = Object.entries(parP).filter(([, v]) => Math.abs(v) >= 5000)
      .sort((a, b) => a[1] - b[1]).map(([id, v]) => ({ proprietaire_id: id, nom: nomP(id), montant: v }))
    parMois.push({
      mois, facture: true, encaisse,
      proprietaires: { du: proprioDuTotal, du_sans_facture: proprioDuSansFacture, paye: proprioPaye, reste: proprioDuTotal - proprioPaye,
        paiements: proprioSorties.map(s => ({ date: s.date_operation, montant: s.debit, libelle: s.libelle })) },
      ae: { du: aeDu, paye: aePaye, reste: aeDu - aePaye },
      dcb: { reste: dcbReste + aeAvanceTotal, paye: dcbPaye, theorique: dcbTheorique, reste_theorique: dcbTheorique - dcbPaye,
        anomalie: (dcbReste + aeAvanceTotal) - (dcbTheorique - dcbPaye), anomalie_par_proprio: anomaliesProprio,
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
  const sortiesAutres = sorties.filter(s => !transitIds.has(s.id) && s.date_operation >= DEBUT_ && ['autre', 'remboursement_voyageur', 'inter_agence'].includes(s.type))
  // Sorties attribuées à un mois antérieur au suivi (reversement de mai payé en juin…) : elles
  // soldent des dettes d'avant la période, hors justificatif.
  const sortiesAnterieures = sorties.filter(s => !transitIds.has(s.id) && s.date_operation >= DEBUT_ && s.mois < MOIS_DEBUT_ &&
    ['reversement', 'reversement_groupe', 'reversement_hors_facture', 'transfert_dcb', 'paiement_ae'].includes(s.type))
  const fraisBancaires = sum(sorties.filter(s => s.type === 'frais_bancaires' && s.date_operation >= DEBUT_), s => s.debit)
  const deboursOuverts = factures.filter(f => f.type_facture === 'debours' && ['envoye_proprio', 'envoye_evoliz', 'valide'].includes(f.statut) && f.mois >= MOIS_DEBUT_ && f.mois <= dernierFacture)
  const tot = k => sum(horsMois[k], m => m.montant)

  const facturesListe = parMois.filter(p => p.facture)
  const poches = [
    { cle: 'proprietaires', label: 'Propriétaires — reversements restant dus', montant: sum(facturesListe, p => p.proprietaires.reste) },
    { cle: 'ae', label: 'AE — ménages et extras non encore payés', montant: sum(facturesListe, p => p.ae.reste) },
    { cle: 'dcb', label: 'DCB — part encore détenue au séquestre (mois facturés)', montant: sum(facturesListe, p => p.dcb.reste) },
    { cle: 'non_factures', label: 'Mois non facturés et séjours à venir — encaissé non encore réparti', montant: sum(parMois.filter(p => !p.facture), p => p.reste) },
    { cle: 'debours_rembourses', label: 'Débours AE (biens où le propriétaire encaisse) : remboursements reçus − ménages avancés par le séquestre', montant: tot('remboursement_debours') - sum(facturesListe, p => p.dcb.debours_ae_avances || 0) },
    { cle: 'factures_payees_sequestre', label: 'Factures d\'honoraires payées sur le séquestre (dues à DCB)', montant: tot('paiement_facture') },
    { cle: 'stripe', label: 'Virements reçus inférieurs aux paiements reliés (frais Stripe, payout partiel Airbnb, lignes Stripe manquantes) / frais Stripe remboursés par DCB', montant: tot('frais_stripe_rembourses') },
    { cle: 'frais_bancaires', label: 'Frais bancaires (nets des remises)', montant: tot('remise_frais_bancaires') - fraisBancaires },
    { cle: 'annulees', label: 'Réservations annulées — net encaissé − remboursé (frais d\'annulation retenus / frais perdus)', montant: sum(annuleesLiens, l => l.montant) },
    { cle: 'plateformes_non_rapprochees', label: 'Encaissements plateformes non reliés à une réservation', montant: tot('plateforme_non_rapprochee') },
    { cle: 'entrees_non_affectees', label: 'Autres encaissements à identifier', montant: tot('non_affecte') + tot('inter_agence') },
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
  // Paiement relié à une résa annulée SANS revenu : lien presque toujours faux (HMKBNZXMPW,
  // 25/09/2026 : payout 1 065,53 € d'un autre séjour du même bien, annulation synchronisée en retard)
  const liensAnnulees = Object.values(annuleesLiens.reduce((a, l) => { (a[l.code] ||= { code: l.code, montant: 0 }).montant += l.montant || 0; return a }, {})).filter(x => Math.abs(x.montant) > 100)
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
  const soldeBanque = solde ?? (await soldeBancaireSequestre())
  const lignes = arr => arr.map(m => ({ date: m.date_operation, montant: m.montant ?? m.debit ?? m.credit, libelle: (m.libelle || '').replace(/\n/g, ' ').slice(0, 120), raison: m.raison }))

  return {
    agence, date, mois_debut: MOIS_DEBUT_,
    solde_banque: soldeBanque,
    total_justifie: totalJustifie,
    ecart: soldeBanque.montant - totalJustifie,
    poches, par_mois: parMois, anomalies, sorties_anterieures_total: totalSortiesAnterieures,
    detail: {
      debours_non_rembourses: deboursOuverts.map(f => ({ mois: f.mois, bien: f.bien?.code, montant: f.total_ttc, statut: f.statut })),
      remboursements_debours: lignes(horsMois.remboursement_debours),
      factures_payees_sequestre: lignes(horsMois.paiement_facture),
      plateformes_non_rapprochees: lignes(horsMois.plateforme_non_rapprochee),
      entrees_a_identifier: lignes([...horsMois.non_affecte, ...horsMois.inter_agence]),
      sorties_a_identifier: lignes(sortiesAutres),
      sorties_anterieures: lignes(sortiesAnterieures),
      annulees: Object.values(annuleesLiens.reduce((a, l) => { (a[l.code] ||= { code: l.code, montant: 0 }).montant += l.montant || 0; return a }, {})),
      retours_dcb: lignes(horsMois.retour_dcb),
      stripe: lignes(horsMois.frais_stripe_rembourses),
      reaffectations: [...affecte.values()],
      transits: transits.map(p => ({ entree: p.entree.libelle?.slice(0, 60), sortie: p.sortie.libelle?.slice(0, 60), montant: p.entree.credit, date: p.entree.date_operation })),
    },
  }
}
