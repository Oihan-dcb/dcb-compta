// ── Justificatif du séquestre — noyau PUR (zéro import base) ─────────────────────────────────
// Loi Hoguet : le séquestre est un compte de mandants. À tout instant, son solde bancaire doit
// être égal à la somme de ce qui est dû à chacun (propriétaires, DCB, AE, voyageurs). Ce module
// classe chaque mouvement bancaire du séquestre location saisonnière (qui il concerne, pour quel
// mois) à partir des conventions de libellés réellement utilisées par DCB (relevé 2026) :
//   « REM VIR SEPA DU 06/08/26 »            → remise SEPA des reversements du mois précédent
//   « HON - JUILLET », « FMEN JUIN 26 », « COM WEB - JUILLET », « HON ITS AOUT » → virement DCB
//   « VIR SEPA EVE - Reason: DEBOURS JUILLET EVE »  → paiement AE (nom de l'AE dans le libellé)
//   « VIR SEPA JULIEN REMOND ITS - Reason: Loyer Aout ITS » → reversement individuel
// Testé : __tests__/sequestreCore.test.js.

import { norm, extraireMois, motsNom } from './lldCore.js'

const moisPrecedent = (dateOp) => {
  const [y, m] = String(dateOp).slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function contientMot(texte, mot) {
  return mot && new RegExp(`(^| )${mot}( |$)`).test(texte)
}

// Nom d'une personne (AE, propriétaire) présent dans le libellé : nom de famille (≥ 4 lettres)
function personneDans(texte, personnes) {
  const trouvees = personnes.filter(p => motsNom(p.nom).some(t => t.length >= 4 && contientMot(texte, t)))
  return trouvees.length === 1 ? trouvees[0] : (trouvees.length > 1 ? trouvees.find(p => motsNom(p.prenom || '').some(t => contientMot(texte, t))) || null : null)
}

// ── Sorties ───────────────────────────────────────────────────────────────────
// ctx : { aes: [{id, nom, prenom}], proprietaires: [{id, nom, prenom}] }
// Retour : { type, mois, tiers_id?, sous? }
//   type ∈ reversement_groupe | reversement | transfert_dcb | paiement_ae | frais_bancaires |
//          inter_agence | remboursement_voyageur | autre
export function classerSortie(mvt, ctx = {}) {
  const brut = `${mvt.libelle || ''} ${mvt.detail || ''}`
  const t = norm(brut)
  const moisLib = extraireMois(brut, mvt.date_operation)
  const mois = moisLib || moisPrecedent(mvt.date_operation)

  if (mvt.canal === 'frais_bancaires' || /^\*?frais /.test(t) || t === 'frais') return { type: 'frais_bancaires', mois: moisDe(mvt.date_operation) }
  if (/^rem vir sepa du/.test(t)) return { type: 'reversement_groupe', mois: moisPrecedent(mvt.date_operation) }
  if (/\blauian\b/.test(t)) return { type: 'inter_agence', mois }
  // Virements DCB : libellé qui COMMENCE par HON / FMEN / COM / COMMISSIONS (convention interne)
  // + variantes réellement utilisées en 2026 : « VIR SEPA DCB MENAGE », « COMM DISTRIBUTION DU MOIS
  // DE J… », « VIREMENT FMEN AVRIL »
  if (/^(vir sepa )?dcb menage\b/.test(t)) return { type: 'transfert_dcb', sous: 'fmen', mois }
  if (/^comm distribution\b/.test(t)) return { type: 'transfert_dcb', sous: 'com', mois }
  const dcb = t.replace(/^virement /, '').match(/^(hon|honoraires|fmen|com|commissions?|commisions?)\b/)
  if (dcb) {
    const sous = dcb[1].startsWith('hon') ? 'hon' : dcb[1] === 'fmen' ? 'fmen' : 'com'
    return { type: 'transfert_dcb', sous, mois }
  }
  const ae = personneDans(t, ctx.aes || [])
  if (ae && !/\bloyers?\b/.test(t)) return { type: 'paiement_ae', mois, tiers_id: ae.id }
  if (/\b(debours|facture|factures)\b/.test(t) && !/\bloyers?\b/.test(t)) return { type: 'paiement_ae', mois, tiers_id: null }
  if (/\b(rembours|remboursement|refund|annulation)\b/.test(t) && !/\bloyer/.test(t)) return { type: 'remboursement_voyageur', mois }
  const proprio = personneDans(t, ctx.proprietaires || [])
  if (proprio || /\b(loyer|loyers|reversement|reve|taxe de sejour)\b/.test(t)) return { type: 'reversement', mois, tiers_id: proprio?.id || null }
  return { type: 'autre', mois }
}

// ── Entrées non reliées à une réservation ────────────────────────────────────
// factures : [{ type_facture, montants: [cts…], proprio_nom }] — un virement d'un propriétaire
// du montant exact d'une de ses factures est un paiement de facture (même sans mot-clé :
// « VIR INST MME BELAIR DOMINIQUE (ref: 408P…) » = facture honoraires 408P août).
export function classerEntree(mvt, factures = []) {
  const t = norm(`${mvt.libelle || ''} ${mvt.detail || ''}`)
  if (/\bfrais stripe\b/.test(t)) return { type: 'frais_stripe_rembourses' }
  if (/^\*? ?remise (sur )?frais|remise frais/.test(t)) return { type: 'remise_frais_bancaires' }
  if (/\b(airbnb|booking|stripe|hospitable)\b/.test(t)) return { type: 'plateforme_non_rapprochee' }
  // Retour d'un virement DCB trop versé (courant → séquestre) : « RETOUR COM AOUT », « HON JUILLET »…
  // Libellé qui commence par la convention interne, ou émis par DCB avec un mot HON/FMEN/COM.
  const retour = t.match(/^(?:retour )?(hon|honoraires|fmen|com|commissions?|commisions?)\b/) ||
    (/\bdestination cote basque\b/.test(t) && t.match(/\b(?:retour )(hon|honoraires|fmen|com|commissions?|commisions?)\b/))
  if (retour) {
    const brut = `${mvt.libelle || ''} ${mvt.detail || ''}`
    const sous = retour[1].startsWith('hon') ? 'hon' : retour[1] === 'fmen' ? 'fmen' : 'com'
    return { type: 'retour_dcb', sous, mois: extraireMois(brut, mvt.date_operation) || moisPrecedent(mvt.date_operation) }
  }
  // Montant exact d'une facture + nom du propriétaire OU code du bien dans le libellé
  // (« VIR SEPA M OU MME CHAUCHET JEAN - Reason: Dul juin 2026 » = débours DUL juin, 318,75 €)
  const f = factures.find(x => x.montants.includes(mvt.credit) && (
    motsNom(x.proprio_nom || '').some(n => n.length >= 4 && contientMot(t, n)) ||
    (x.bien_code && norm(x.bien_code).length >= 3 && contientMot(t, norm(x.bien_code)))))
  if (f) return { type: f.type_facture === 'debours' ? 'remboursement_debours' : 'paiement_facture' }
  if (/\b(debours|rebours|debour)\b/.test(t)) return { type: 'remboursement_debours' }
  if (/\b(facturation|facture|honoraires)\b/.test(t)) return { type: 'paiement_facture' }
  if (/\blauian\b/.test(t)) return { type: 'inter_agence' }
  return { type: 'non_affecte' }
}

// Transit : un encaissement ressorti tel quel vers une autre structure (ex. voyageur Lauïan payé
// sur le séquestre DCB puis reversé à Lauïan : « VIR INST LAUIAN IMMOBILIER - Reason: VIR INST
// EJM DE WINNE » 3 750 €). Même montant, libellé de la sortie qui cite le payeur, ≤ 45 jours.
export function apparierTransits(entrees, sorties) {
  const paires = []
  const pris = new Set()
  for (const s of sorties) {
    const ts = norm(`${s.libelle || ''} ${s.detail || ''}`)
    const e = entrees.find(x => !pris.has(x.id) && x.credit === s.debit &&
      Math.abs(new Date(s.date_operation) - new Date(x.date_operation)) <= 45 * 86400000 &&
      norm(x.libelle).split(' ').filter(w => w.length >= 4 && !['inst', 'sepa', 'reason'].includes(w)).some(w => contientMot(ts, w)))
    if (e) { pris.add(e.id); paires.push({ entree: e, sortie: s }) }
  }
  return paires
}

export function moisDe(d) { return String(d).slice(0, 7) }
