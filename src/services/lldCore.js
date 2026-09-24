// ── Moteur de rapprochement LLD (locations longues / étudiants) — noyau PUR ─────────────────
// Zéro import (ni supabase, ni AGENCE) : testé en isolation (__tests__/lldCore.test.js) et
// partagé par le cron nocturne (api/lld-auto.js, pennylane-lld-sync) et l'interface.
//
// Pourquoi (audit LLD, 24/09/2026) : l'ancien matching exigeait nom ET prénom de l'étudiant
// dans le libellé → ratait presque tout, car ce sont souvent les PARENTS qui paient
// (« VIR INST MME SIMONE KHAZIZIAN » pour Maëlia HAVARD KHAZIZIAN), ou une PLATEFORME
// (« STRIPE STUDAPART T LE ROCHAIS », montant net de commission). Les cautions et frais
// arrivaient sur le compte loyers sans être reconnus, et le mois était déduit de la date
// bancaire (un loyer de septembre payé le 30/08 était compté pour août).

const PARTICULES = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'van', 'von', 'der', 'di', 'da', 'del', 'mme', 'mr', 'mlle', 'm', 'ei'])

// Plateformes qui encaissent le loyer et reversent un montant NET de leur commission : le loyer
// est considéré payé en totalité (la commission n'est pas une dette de l'étudiant).
export const PLATEFORMES_LLD = ['studapart']

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

function contientMot(texteNorm, mot) {
  return mot && new RegExp(`(^| )${mot}( |$)`).test(texteNorm)
}

// Mots significatifs d'un nom composé (« LE ROCHAIS » → rochais ; « HAVARD KHAZIZIAN » →
// havard, khazizian). ≥ 3 lettres, particules exclues.
export function motsNom(s) {
  return norm(s).split(' ').filter(t => t.length >= 3 && !PARTICULES.has(t))
}

// ── Type de mouvement ─────────────────────────────────────────────────────────
export function classerMouvement(texte) {
  const t = norm(texte)
  if (/\b(caution|depot de garantie|depot garantie|garantie)\b/.test(t)) return 'caution'
  if (/\b(loyer|loyers|rent|studapart|quittance)\b/.test(t)) return 'loyer'
  if (/\b(frais|honoraires|dossier|agence|etat des lieux)\b/.test(t)) return 'frais'
  return 'inconnu'
}

// ── Mois indiqué dans le libellé (« LOYER SEPT 26 », « Loyer septembre », « 09/2026 ») ─────
const MOIS_MOTS = [
  ['janvier', 1], ['janv', 1], ['jan', 1],
  ['fevrier', 2], ['fevr', 2], ['fev', 2],
  ['mars', 3],
  ['avril', 4], ['avr', 4],
  ['mai', 5],
  ['juin', 6],
  ['juillet', 7], ['juil', 7],
  ['aout', 8],
  ['septembre', 9], ['sept', 9], ['sep', 9],
  ['octobre', 10], ['oct', 10],
  ['novembre', 11], ['nov', 11],
  ['decembre', 12], ['dec', 12],
]
const ymStr = (y, m) => `${y}-${String(m).padStart(2, '0')}`

export function extraireMois(texte, dateOperation) {
  const t = norm(texte)
  const [dy, dm] = String(dateOperation || '').slice(0, 7).split('-').map(Number)
  // Forme numérique 09/2026, 09 2026, 2026 09
  let m = t.match(/\b(0?[1-9]|1[0-2]) (20\d\d)\b/)
  if (m) return ymStr(+m[2], +m[1])
  m = t.match(/\b(20\d\d) (0?[1-9]|1[0-2])\b/)
  if (m) return ymStr(+m[1], +m[2])
  for (const [mot, num] of MOIS_MOTS) {
    const r = new RegExp(`(^| )${mot}( (20\\d\\d|\\d\\d))?( |$)`).exec(t)
    if (!r) continue
    if (r[3]) return ymStr(r[3].length === 2 ? 2000 + +r[3] : +r[3], num)
    if (!dy) return null
    // Année absente : celle qui place le mois au plus près de la date du virement
    // (loyer payé en avance jusqu'à 2 mois, ou en retard jusqu'à 9 mois).
    const candidats = [dy - 1, dy, dy + 1].map(y => ({ y, ecart: (y - dy) * 12 + (num - dm) }))
      .filter(c => c.ecart >= -9 && c.ecart <= 2)
      .sort((a, b) => Math.abs(a.ecart) - Math.abs(b.ecart))
    return candidats.length ? ymStr(candidats[0].y, num) : null
  }
  return null
}

// ── Montants ────────────────────────────────────────────────────────────────
export function loyerCC(e) {
  return (e.loyer_nu || 0) + (e.supplement_loyer || 0) + (e.charges_eau || 0) + (e.charges_copro || 0) + (e.charges_internet || 0)
}

function presentVers(e, dateOperation) {
  // Présent (±60 j) à la date du paiement : évite d'attribuer à un ancien locataire du même nom
  const d = String(dateOperation || '').slice(0, 10)
  if (!d) return true
  const ajoute = (s, jours) => { const x = new Date(s + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + jours); return x.toISOString().slice(0, 10) }
  if (e.date_entree && d < ajoute(String(e.date_entree).slice(0, 10), -60)) return false
  const sortie = e.date_sortie_reelle || e.date_sortie_prevue
  if (sortie && d > ajoute(String(sortie).slice(0, 10), 60)) return false
  return true
}

// ── Qui a payé ? ──────────────────────────────────────────────────────────────
// payeurs : [{ etudiant_id, motif }] — libellés mémorisés (ex. « simone khazizian »),
// appris quand un mouvement est rattaché à la main.
// Retour : { etudiant, confiance: 'certain' | 'probable', raison } ou null.
export function identifierEtudiant(mouvement, etudiants, payeurs = []) {
  const texte = norm(`${mouvement.libelle || ''} ${mouvement.detail || ''}`)
  const montant = mouvement.credit || 0
  const type = classerMouvement(texte)
  const plateforme = PLATEFORMES_LLD.find(p => contientMot(texte, p)) || null
  const candidats = etudiants.filter(e => presentVers(e, mouvement.date_operation))

  // 1. Payeur mémorisé
  for (const p of payeurs) {
    const motif = norm(p.motif)
    if (motif.length >= 4 && texte.includes(motif)) {
      const e = etudiants.find(x => x.id === p.etudiant_id)
      if (e) return { etudiant: e, confiance: 'certain', raison: `payeur mémorisé « ${p.motif} »`, type, plateforme }
    }
  }

  // 2. Nom de famille (étudiant ou parent qui porte le même nom), prénom en bonus
  let scores = candidats.map(e => ({
    e,
    nomOk: motsNom(e.nom).some(t => contientMot(texte, t)),
    prenomOk: motsNom(e.prenom).some(t => contientMot(texte, t)),
  })).filter(s => s.nomOk)
  // Nom et prénom parfois inversés à la saisie (fiche « Antoine MONBAILLY ») : si aucun nom ne
  // correspond, on retente sur le prénom — au mieux « probable », jamais « certain ».
  let inverse = false
  if (!scores.length) {
    scores = candidats.map(e => ({ e, nomOk: motsNom(e.prenom).some(t => t.length >= 4 && contientMot(texte, t)), prenomOk: false }))
      .filter(s => s.nomOk)
    inverse = scores.length > 0
  }

  if (scores.length) {
    const complets = scores.filter(s => s.prenomOk)
    const retenus = complets.length ? complets : scores
    if (retenus.length === 1) {
      const e = retenus[0].e
      const cc = loyerCC(e)
      const montantCoherent = plateforme || type === 'caution' || type === 'frais' ||
        (cc > 0 && (Math.abs(montant - cc) <= 100 || (montant > cc && montant % cc <= 100)))
      if (inverse) return { etudiant: e, confiance: 'probable', raison: 'prénom seul (nom/prénom inversés sur la fiche ?)', type, plateforme }
      return {
        etudiant: e,
        confiance: retenus[0].prenomOk || montantCoherent ? 'certain' : 'probable',
        raison: retenus[0].prenomOk ? 'nom + prénom' : (montantCoherent ? 'nom + montant cohérent' : 'nom seul (montant inhabituel)'),
        type, plateforme,
      }
    }
    return null // plusieurs étudiants du même nom : à trancher à la main
  }

  // 3. Montant exact = loyer CC d'un seul locataire présent (libellé muet)
  if (montant > 0 && type !== 'caution' && type !== 'frais') {
    const parMontant = candidats.filter(e => loyerCC(e) === montant)
    if (parMontant.length === 1) return { etudiant: parMontant[0], confiance: 'probable', raison: 'montant exact du loyer', type, plateforme }
  }
  return null
}

// ── À quel mois de loyer affecter un paiement ? ────────────────────────────────
// loyersOuverts : loyers non soldés de l'étudiant [{ id, mois, montant_attendu, montant_recu }].
// Priorité au mois écrit dans le libellé, sinon le plus ancien loyer ouvert de la fenêtre
// [paiement − 2 mois ; paiement + 1 mois]. null = avance / dette ancienne → à traiter à la main.
export function choisirLoyer(mouvement, loyersOuverts) {
  if (!loyersOuverts?.length) return null
  const tri = [...loyersOuverts].sort((a, b) => a.mois.localeCompare(b.mois))
  const moisLibelle = extraireMois(`${mouvement.libelle || ''} ${mouvement.detail || ''}`, mouvement.date_operation)
  if (moisLibelle) {
    const l = tri.find(x => x.mois === moisLibelle)
    if (l) return l
  }
  // Fenêtre : de 2 mois avant le paiement au mois suivant (payé d'avance). Une vieille dette
  // (loyer d'avril resté « attendu ») n'absorbe jamais seule un paiement de septembre.
  const [y, m] = String(mouvement.date_operation).slice(0, 7).split('-').map(Number)
  const decale = n => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return ymStr(d.getUTCFullYear(), d.getUTCMonth() + 1) }
  const debut = decale(-2), fin = decale(1)
  return tri.find(x => x.mois >= debut && x.mois <= fin) || null
}

// Loyer soldé ? (1 € de tolérance ; plateforme = payé même net de sa commission)
export function loyerSolde(loyer, cumulRecu, plateforme) {
  if (plateforme) return true
  return cumulRecu >= (loyer.montant_attendu || 0) - 100
}

// ── Mémoire des payeurs : nom du donneur d'ordre dans un libellé bancaire ─────
// « VIR INST MME SIMONE KHAZIZIAN (ref: …) - Reason: LOYER » → « simone khazizian »
// « VIR SEPA STRIPE (ref: STUDAPART-…) - Reason: STUDAPART T LE ROCHAIS » → null (plateforme :
//   on mémorise alors le texte après la plateforme, « t le rochais »)
const CIVILITES = new Set(['mme', 'mr', 'm', 'mlle', 'mrs', 'ms', 'ei', 'monsieur', 'madame', 'mademoiselle'])
export function extrairePayeur(libelle) {
  const brut = String(libelle || '')
  const plateforme = PLATEFORMES_LLD.find(p => norm(brut).includes(p))
  if (plateforme) {
    const apres = norm(brut).split(plateforme).pop().replace(/^[a-z0-9]{8,} ?/, '').trim()
    const mots = apres.split(' ').filter(Boolean).slice(0, 4)
    return mots.join(' ').length >= 4 ? mots.join(' ') : null
  }
  const tete = brut.split(/\(|\n| - Reason|reason:/i)[0]
  const mots = norm(tete).split(' ')
    .filter(t => t && !['vir', 'inst', 'sepa', 'virement', 'de', 'recu', 'instantane', 'europeen'].includes(t) && !CIVILITES.has(t))
    .slice(0, 4)
  const motif = mots.join(' ')
  return motif.length >= 4 ? motif : null
}
