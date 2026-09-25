// Clôtures et journal du séquestre (migration 283) — multi-agence.
//
// · cloturerMois : fige la photo du justificatif calculé au dernier jour du mois (poches, ligne du mois,
//   écart) dans sequestre_cloture_mensuelle et verrouille le mois (les affectations manuelles de ce
//   mois sont alors refusées par trigger). Refusé si le mois n'est pas terminé, si le mois précédent
//   suivi n'est pas clôturé, ou si l'écart dépasse le seuil sans forcer (motif obligatoire).
// · rouvrirMois : déverrouille (motif obligatoire, journalisé).
// · cloturerExercice : exige tous les mois de l'exercice clôturés, fige la photo à la date de fin,
//   passe l'exercice en « clôturé » et ouvre le suivant (solde d'ouverture = solde du relevé à la fin).
// · deriveMoisClotures : compare le calcul du jour aux photos figées des mois clôturés — une valeur
//   qui bouge sur un mois clôturé (frais modifié après coup, lien changé…) doit se voir.
// · journaliser : écrit une ligne dans sequestre_journal.

import { supabase } from '../lib/supabase'
import { justifierSequestre, compteSequestre } from './sequestreJustificatif'

const SEUIL_ECART = 100 // 1 € : au-delà, clôture refusée sauf forçage motivé
const finDeMois = mois => { const [y, m] = mois.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
const moisPlus = (mois, n) => { const [y, m] = mois.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export async function journaliser(agence, type, message, { mois = null, montant = null, detail = null, auteur = null } = {}) {
  const { error } = await supabase.from('sequestre_journal').insert({ agence, type, message, mois, montant, detail, auteur })
  if (error) console.error('[sequestre_journal]', error.message)
}

export async function listerClotures(agence) {
  const { data, error } = await supabase.from('sequestre_cloture_mensuelle').select('*').eq('agence', agence).order('mois')
  if (error) throw error
  return data || []
}

export async function cloturerMois(agence, mois, { auteur, forcer = false, note = null } = {}) {
  const compte = await compteSequestre(agence)
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const dateArrete = finDeMois(mois)
  if (dateArrete >= aujourdhui) throw new Error(`${mois} n'est pas terminé`)
  if (mois < compte.mois_debut) throw new Error(`${mois} est antérieur au suivi (${compte.mois_debut})`)
  const clotures = await listerClotures(agence)
  const precedent = moisPlus(mois, -1)
  if (mois > compte.mois_debut && !clotures.some(c => c.mois === precedent && c.verrouille))
    throw new Error(`Clôturer d'abord ${precedent}`)
  if (clotures.some(c => c.mois === mois && c.verrouille)) throw new Error(`${mois} est déjà clôturé`)

  const j = await justifierSequestre(agence, { date: dateArrete })
  const ligneMois = j.par_mois.find(p => p.mois === mois) || null
  if (Math.abs(j.ecart) > SEUIL_ECART && !forcer)
    throw new Error(`Écart de ${eur(j.ecart)} au ${dateArrete.split('-').reverse().join('/')} : expliquer l'écart ou forcer la clôture avec un motif`)
  if (forcer && !note) throw new Error('Motif obligatoire pour forcer une clôture avec écart')

  const parAyantDroit = ligneMois?.facture ? [
    { ayant_droit: 'proprietaires', du: ligneMois.proprietaires.du, paye: ligneMois.proprietaires.paye, reste: ligneMois.proprietaires.reste, detail: ligneMois.proprietaires.par_proprio },
    { ayant_droit: 'ae', du: ligneMois.ae.du, paye: ligneMois.ae.paye, reste: ligneMois.ae.reste },
    { ayant_droit: 'agence', du: ligneMois.dcb.theorique, paye: ligneMois.dcb.paye, reste: ligneMois.dcb.reste },
  ] : []
  const { error } = await supabase.from('sequestre_cloture_mensuelle').upsert({
    agence, mois, date_arrete: dateArrete, solde_banque: j.solde_banque.montant, total_justifie: j.total_justifie, ecart: j.ecart,
    poches: j.poches, mois_detail: ligneMois, par_ayant_droit: parAyantDroit, note,
    verrouille: true, verrouille_par: auteur || null, verrouille_le: new Date().toISOString(),
  }, { onConflict: 'agence,mois' })
  if (error) throw error
  await journaliser(agence, 'cloture_mois', `Clôture de ${mois} : solde ${eur(j.solde_banque.montant)}, justifié ${eur(j.total_justifie)}, écart ${eur(j.ecart)}${forcer ? ` — forcée : ${note}` : ''}`,
    { mois, montant: j.ecart, auteur, detail: { date_arrete: dateArrete, anomalies: j.anomalies.length } })
  return { mois, dateArrete, ecart: j.ecart, solde: j.solde_banque.montant }
}

export async function rouvrirMois(agence, mois, { auteur, motif }) {
  if (!motif) throw new Error('Motif obligatoire pour rouvrir un mois clôturé')
  const clotures = await listerClotures(agence)
  const suivants = clotures.filter(c => c.mois > mois && c.verrouille).map(c => c.mois)
  if (suivants.length) throw new Error(`Rouvrir d'abord ${suivants.reverse().join(', ')}`)
  const { error } = await supabase.from('sequestre_cloture_mensuelle').update({ verrouille: false, note: `Rouvert : ${motif}` }).eq('agence', agence).eq('mois', mois)
  if (error) throw error
  await journaliser(agence, 'reouverture_mois', `Réouverture de ${mois} : ${motif}`, { mois, auteur })
}

export async function exerciceEnCours(agence) {
  const { data } = await supabase.from('sequestre_exercice').select('*').eq('agence', agence).eq('statut', 'ouvert').order('debut', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function cloturerExercice(agence, { auteur, forcer = false, note = null } = {}) {
  const ex = await exerciceEnCours(agence)
  if (!ex) throw new Error('Aucun exercice ouvert')
  const aujourdhui = new Date().toISOString().slice(0, 10)
  if (ex.fin >= aujourdhui) throw new Error(`L'exercice se termine le ${ex.fin.split('-').reverse().join('/')}`)
  const compte = await compteSequestre(agence)
  const clotures = await listerClotures(agence)
  const manquants = []
  for (let m = [ex.debut.slice(0, 7), compte.mois_debut].sort().pop(); m <= ex.fin.slice(0, 7); m = moisPlus(m, 1))
    if (!clotures.some(c => c.mois === m && c.verrouille)) manquants.push(m)
  if (manquants.length) throw new Error(`Mois à clôturer d'abord : ${manquants.join(', ')}`)
  const j = await justifierSequestre(agence, { date: ex.fin })
  if (Math.abs(j.ecart) > SEUIL_ECART && !(forcer && note)) throw new Error(`Écart de ${eur(j.ecart)} à la fin de l'exercice : forcer avec un motif`)
  const { error } = await supabase.from('sequestre_exercice').update({
    statut: 'cloture', solde_cloture: j.solde_banque.montant, ecart_cloture: j.ecart, poches_cloture: j.poches,
    cloture_le: new Date().toISOString(), cloture_par: auteur || null, note: [ex.note, note].filter(Boolean).join(' — '),
  }).eq('agence', agence).eq('debut', ex.debut)
  if (error) throw error
  const debut = new Date(Date.parse(ex.fin) + 86400000).toISOString().slice(0, 10)
  const fin = new Date(Date.UTC(Number(debut.slice(0, 4)) + 1, Number(debut.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10)
  const { error: e2 } = await supabase.from('sequestre_exercice').insert({ agence, debut, fin, statut: 'ouvert', solde_ouverture: j.solde_banque.montant,
    note: `Ouvert à la clôture de l'exercice ${ex.debut.slice(0, 4)}${ex.fin.slice(0, 4) !== ex.debut.slice(0, 4) ? '-' + ex.fin.slice(0, 4) : ''}` })
  if (e2) throw e2
  await journaliser(agence, 'cloture_exercice', `Clôture de l'exercice ${ex.debut} → ${ex.fin} : solde ${eur(j.solde_banque.montant)}, écart ${eur(j.ecart)} ; exercice suivant ouvert le ${debut}`,
    { montant: j.ecart, auteur })
  return { ...ex, solde_cloture: j.solde_banque.montant, ecart: j.ecart, suivant: { debut, fin } }
}

// Dérive des mois clôturés : recalcule le justificatif À LA DATE D'ARRÊTÉ de chaque mois clôturé et
// compare à la photo figée (écart, total justifié, poches, ligne du mois). Même date = même périmètre :
// seule une donnée modifiée après coup (frais, lien, facture, mouvement) peut faire bouger les chiffres.
// max : nombre de mois clôturés vérifiés (les plus récents) — chaque recalcul prend ~10 s.
export async function verifierClotures(agence, clotures, { max = 3 } = {}) {
  const derives = []
  for (const c of clotures.filter(c => c.verrouille && c.date_arrete).sort((a, b) => b.mois.localeCompare(a.mois)).slice(0, max)) {
    const j = await justifierSequestre(agence, { date: c.date_arrete })
    const now = j.par_mois.find(p => p.mois === c.mois)
    const f = c.mois_detail || {}
    const champs = [['écart', c.ecart, j.ecart], ['total justifié', c.total_justifie, j.total_justifie],
      ['encaissé du mois', f.encaisse, now?.encaisse],
      ['propriétaires restant dus', f.proprietaires?.reste, now?.proprietaires?.reste],
      ['AE restant dus', f.ae?.reste, now?.ae?.reste], ['part agence détenue', f.dcb?.reste, now?.dcb?.reste]]
    for (const p of c.poches || []) champs.push([`poche « ${p.label.slice(0, 60)} »`, p.montant, (j.poches.find(x => x.cle === p.cle) || {}).montant])
    for (const [nom, avant, apres] of champs) if (avant != null && Math.abs((apres || 0) - (avant || 0)) > 100)
      derives.push({ mois: c.mois, champ: nom, avant, apres: apres || 0, delta: (apres || 0) - (avant || 0) })
  }
  return derives
}
