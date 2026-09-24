// ── LLD automatique (audit 24/09/2026, I-159) ────────────────────────────────────────────────
// Ce que Laura devait faire à la main chaque mois, et qui ne se faisait plus depuis juin :
// préparer les loyers, rapprocher les virements, suivre cautions / virements propriétaires,
// générer les factures d'honoraires LLD. Lancé chaque nuit par api/lld-auto.js (après l'import
// bancaire Pennylane de 03:55), et à la demande depuis l'écran « LLD — ce mois-ci ».
// Moteur de rapprochement PUR : lldCore.js (testé). Ici : lectures / écritures uniquement.

import { supabase } from '../lib/supabase.js'
import { AGENCE } from '../lib/agence.js'
import { identifierEtudiant, choisirLoyer, loyerSolde, classerMouvement, extrairePayeur, norm } from './lldCore.js'
import { initialiserLoyersMois, listerEtudiants, prorataMois, montantTotalEtudiant } from './locationsLongues.js'
import { genererFacturesLLD } from './facturesLLD.js'
import { autoMatcherVirementsProprioLLD } from './lldBanque.js'

// Mouvements déjà « rapprochés » (ancien moteur) mais jamais affectés à un loyer : repris
// seulement à partir de l'arrêt du suivi (juillet 2026). Avant, le loyer du mois a déjà été
// marqué reçu par l'ancien moteur — les reprendre compterait le paiement deux fois.
const BASCULE = '2026-07-01'

const moisDe = d => String(d).slice(0, 7)
const moisPlus = (mois, n) => {
  const [y, m] = mois.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ── 1. Statuts : en attente → actif à la date d'entrée ; sortie réelle passée → parti ──────
export async function promouvoirStatuts(agence = AGENCE, today = new Date().toISOString().slice(0, 10), dryRun = false) {
  const { data, error } = await supabase.from('etudiant')
    .select('id, statut, date_entree, date_sortie_reelle').eq('agence', agence).eq('archived', false)
  if (error) throw error
  const versActif = (data || []).filter(e => e.statut === 'en_attente' && e.date_entree && e.date_entree <= today)
  const versParti = (data || []).filter(e => e.statut === 'actif' && e.date_sortie_reelle && e.date_sortie_reelle < today)
  if (!dryRun) {
    if (versActif.length) await supabase.from('etudiant').update({ statut: 'actif', updated_at: new Date().toISOString() }).in('id', versActif.map(e => e.id))
    if (versParti.length) await supabase.from('etudiant').update({ statut: 'parti', updated_at: new Date().toISOString() }).in('id', versParti.map(e => e.id))
  }
  return { actives: versActif.length, partis: versParti.length }
}

// ── 2. Rapprochement bancaire (compte loyers + compte cautions) ──────────────────────────
export async function rapprocherLLD(agence = AGENCE, { dryRun = false, loyersVirtuels = null } = {}) {
  const [{ data: etudiants, error: e1 }, { data: payeurs, error: e2 }, { data: mvts, error: e3 }, { data: ouverts, error: e4 }] = await Promise.all([
    supabase.from('etudiant').select('id, nom, prenom, loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet, caution, date_entree, date_sortie_prevue, date_sortie_reelle, archived').eq('agence', agence),
    supabase.from('etudiant_payeur').select('etudiant_id, motif').eq('agence', agence),
    supabase.from('lld_mouvement_bancaire')
      .select('id, compte, date_operation, libelle, detail, credit, statut, etudiant_id, loyer_suivi_id, type_mouvement')
      .eq('agence', agence).gt('credit', 0)
      // Uniquement à partir de la bascule : avant, le suivi était à l'arrêt ou tenu par l'ancien
      // moteur, et les loyers encore « attendus » ne sont pas fiables (traitement à la main).
      .gte('date_operation', BASCULE)
      .or('statut.eq.non_rapproche,and(statut.eq.rapproche,loyer_suivi_id.is.null,type_mouvement.is.null,compte.eq.loyers)')
      .order('date_operation'),
    supabase.from('loyer_suivi').select('id, etudiant_id, mois, montant_attendu, montant_recu, statut')
      .eq('agence', agence).in('statut', ['attendu', 'en_retard']).gte('mois', moisDe(BASCULE)),
  ])
  for (const e of [e1, e2, e3, e4]) if (e) throw e
  // Simulation : loyers virtuels des mois que la nuit préparerait (sinon tout tomberait en
  // « mois non préparé » et la simulation ne dirait rien d'utile)
  if (dryRun && loyersVirtuels?.length) {
    const cles = new Set((ouverts || []).map(l => `${l.etudiant_id}|${l.mois}`))
    for (const v of loyersVirtuels) if (!cles.has(`${v.etudiant_id}|${v.mois}`)) (ouverts || []).push(v)
  }

  const ouvertsParEtudiant = new Map()
  for (const l of ouverts || []) {
    if (!ouvertsParEtudiant.has(l.etudiant_id)) ouvertsParEtudiant.set(l.etudiant_id, [])
    ouvertsParEtudiant.get(l.etudiant_id).push(l)
  }

  const res = { traites: 0, loyers_recus: 0, loyers_partiels: 0, cautions: 0, frais: 0, suggestions: 0, non_reconnus: 0, avances: 0, decisions: [] }
  for (const m of mvts || []) {
    res.traites++
    const dejaLie = m.statut === 'rapproche' && m.etudiant_id
    const ident = dejaLie
      ? { etudiant: (etudiants || []).find(e => e.id === m.etudiant_id), confiance: 'certain', raison: 'rapproché avant la v2', type: classerMouvement(`${m.libelle} ${m.detail}`), plateforme: null }
      : identifierEtudiant(m, etudiants || [], payeurs || [])
    const nomE = ident?.etudiant ? [ident.etudiant.prenom, ident.etudiant.nom].filter(Boolean).join(' ') : null

    if (!ident?.etudiant) {
      res.non_reconnus++
      res.decisions.push({ mouvement_id: m.id, date: m.date_operation, credit: m.credit, libelle: m.libelle, decision: 'non_reconnu' })
      if (!dryRun && !dejaLie) await supabase.from('lld_mouvement_bancaire').update({ suggestion_etudiant_id: null, match_confiance: null, match_raison: 'non reconnu', type_mouvement: classerMouvement(`${m.libelle} ${m.detail}`) }).eq('id', m.id)
      continue
    }
    if (ident.confiance === 'probable') {
      res.suggestions++
      res.decisions.push({ mouvement_id: m.id, date: m.date_operation, credit: m.credit, libelle: m.libelle, decision: 'suggestion', etudiant: nomE, raison: ident.raison })
      if (!dryRun) await supabase.from('lld_mouvement_bancaire').update({ suggestion_etudiant_id: ident.etudiant.id, match_confiance: 'probable', match_raison: ident.raison, type_mouvement: ident.type }).eq('id', m.id)
      continue
    }

    // Certain
    const type = m.compte === 'cautions' ? 'caution' : (ident.type === 'inconnu' ? 'loyer' : ident.type)
    const base = { etudiant_id: ident.etudiant.id, statut: 'rapproche', type_mouvement: type, match_confiance: dejaLie ? 'manuel' : 'certain', match_raison: ident.raison, suggestion_etudiant_id: null }

    if (type === 'caution') {
      res.cautions++
      res.decisions.push({ mouvement_id: m.id, date: m.date_operation, credit: m.credit, decision: 'caution', etudiant: nomE })
      if (!dryRun) {
        await supabase.from('lld_mouvement_bancaire').update(base).eq('id', m.id)
        const { data: c } = await supabase.from('caution_suivi').select('id, montant_recu').eq('etudiant_id', ident.etudiant.id).maybeSingle()
        const maj = { montant_recu: (c?.montant_recu || 0) + m.credit, date_reception: m.date_operation, mouvement_id: m.id }
        if (c) await supabase.from('caution_suivi').update(maj).eq('id', c.id)
        else await supabase.from('caution_suivi').insert({ agence, etudiant_id: ident.etudiant.id, statut: 'en_cours', ...maj })
      }
      continue
    }
    if (type === 'frais') {
      res.frais++
      res.decisions.push({ mouvement_id: m.id, date: m.date_operation, credit: m.credit, decision: 'frais', etudiant: nomE })
      if (!dryRun) await supabase.from('lld_mouvement_bancaire').update(base).eq('id', m.id)
      continue
    }

    // Loyer
    const liste = ouvertsParEtudiant.get(ident.etudiant.id) || []
    const loyer = choisirLoyer(m, liste)
    if (!loyer) {
      res.avances++
      res.decisions.push({ mouvement_id: m.id, date: m.date_operation, credit: m.credit, decision: 'avance_ou_mois_non_prepare', etudiant: nomE })
      if (!dryRun) await supabase.from('lld_mouvement_bancaire').update(base).eq('id', m.id)
      continue
    }
    // Plateforme (Studapart…) : l'étudiant a payé le loyer PLEIN à la plateforme, qui reverse
    // un net de sa commission → le loyer (et la quittance) portent le montant plein ; le net et
    // la commission restent tracés sur le mouvement bancaire.
    const cumul = ident.plateforme
      ? Math.max((loyer.montant_recu || 0) + m.credit, loyer.montant_attendu || 0)
      : (loyer.montant_recu || 0) + m.credit
    if (ident.plateforme) base.match_raison = `${ident.raison} · ${ident.plateforme} : net ${(m.credit / 100).toFixed(2)} € (commission plateforme ${(((loyer.montant_attendu || 0) - m.credit) / 100).toFixed(2)} €)`
    const solde = loyerSolde(loyer, cumul, ident.plateforme)
    if (solde) { res.loyers_recus++; ouvertsParEtudiant.set(ident.etudiant.id, liste.filter(x => x.id !== loyer.id)) }
    else { res.loyers_partiels++; loyer.montant_recu = cumul }
    res.decisions.push({ mouvement_id: m.id, date: m.date_operation, credit: m.credit, decision: solde ? 'loyer_recu' : 'loyer_partiel', etudiant: nomE, mois: loyer.mois })
    if (!dryRun) {
      await supabase.from('lld_mouvement_bancaire').update({ ...base, loyer_suivi_id: loyer.id }).eq('id', m.id)
      await supabase.from('loyer_suivi').update({
        montant_recu: cumul, date_reception: m.date_operation, ...(solde ? { statut: 'recu' } : {}),
      }).eq('id', loyer.id).in('statut', ['attendu', 'en_retard'])
    }
  }
  return res
}

// ── Rattachement manuel (écran) : applique ET mémorise le payeur pour les mois suivants ────
export async function rattacherMouvementLLD(mouvementId, etudiantId, agence = AGENCE) {
  const { data: m, error } = await supabase.from('lld_mouvement_bancaire').select('id, libelle, detail').eq('id', mouvementId).single()
  if (error) throw error
  const motif = extrairePayeur(`${m.libelle || ''}\n${m.detail || ''}`)
  if (motif) {
    await supabase.from('etudiant_payeur').upsert({ agence, etudiant_id: etudiantId, motif: norm(motif), source: 'appris' }, { onConflict: 'etudiant_id,motif', ignoreDuplicates: true })
  }
  // Le mouvement redevient « à traiter » avec un payeur connu → le moteur l'affecte au bon
  // loyer / à la caution, exactement comme la nuit.
  const { error: e2 } = await supabase.from('lld_mouvement_bancaire')
    .update({ statut: 'non_rapproche', etudiant_id: null, suggestion_etudiant_id: null, loyer_suivi_id: null, type_mouvement: null })
    .eq('id', mouvementId)
  if (e2) throw e2
  const r = await rapprocherLLD(agence)
  return { motif, ...r }
}

// Dissocier un mouvement rapproché à tort : retire aussi le paiement du loyer / de la caution.
export async function dissocierMouvementLLD(mouvementId) {
  const { data: m, error } = await supabase.from('lld_mouvement_bancaire')
    .select('id, credit, etudiant_id, loyer_suivi_id, type_mouvement').eq('id', mouvementId).single()
  if (error) throw error
  if (m.loyer_suivi_id) {
    const { data: l } = await supabase.from('loyer_suivi').select('id, montant_recu, quittance_envoyee_at').eq('id', m.loyer_suivi_id).single()
    if (l?.quittance_envoyee_at) throw new Error('Quittance déjà envoyée pour ce loyer : dissociation impossible depuis ici.')
    const reste = Math.max(0, (l?.montant_recu || 0) - (m.credit || 0))
    await supabase.from('loyer_suivi').update({ montant_recu: reste || null, statut: 'attendu', ...(reste ? {} : { date_reception: null }) }).eq('id', m.loyer_suivi_id)
  }
  if (m.type_mouvement === 'caution' && m.etudiant_id) {
    const { data: c } = await supabase.from('caution_suivi').select('id, montant_recu').eq('etudiant_id', m.etudiant_id).maybeSingle()
    if (c) await supabase.from('caution_suivi').update({ montant_recu: Math.max(0, (c.montant_recu || 0) - (m.credit || 0)) || null }).eq('id', c.id)
  }
  const { error: e2 } = await supabase.from('lld_mouvement_bancaire')
    .update({ etudiant_id: null, statut: 'non_rapproche', loyer_suivi_id: null, type_mouvement: null, match_confiance: null, match_raison: 'dissocié à la main', suggestion_etudiant_id: null })
    .eq('id', mouvementId)
  if (e2) throw e2
}

// ── 3. Ce qu'il reste à faire (écran + récap) ─────────────────────────────────────────────
export async function aFaireLLD(agence = AGENCE, today = new Date().toISOString().slice(0, 10)) {
  const moisCourant = moisDe(today)
  const [{ data: loyers }, { data: mvts }, { data: virements }, { data: etudiants }, { data: cautions }] = await Promise.all([
    supabase.from('loyer_suivi').select('id, mois, statut, montant_attendu, montant_recu, nb_relances, etudiant:etudiant_id(id, nom, prenom, email, telephone, jour_paiement_attendu, archived, bien:bien_id(code))')
      .eq('agence', agence).in('statut', ['attendu', 'en_retard']).lte('mois', moisCourant),
    supabase.from('lld_mouvement_bancaire').select('id, date_operation, libelle, credit, compte, match_raison, suggestion:suggestion_etudiant_id(id, nom, prenom)')
      .eq('agence', agence).eq('statut', 'non_rapproche').gt('credit', 100).gte('date_operation', BASCULE).order('date_operation', { ascending: false }),
    supabase.from('virement_proprio_suivi').select('id, mois, montant, statut, etudiant:etudiant_id(id, nom, prenom, archived, proprietaire:proprietaire_id(nom, prenom), bien:bien_id(code))')
      .eq('agence', agence).eq('statut', 'a_virer').lte('mois', moisCourant).gte('mois', moisDe(BASCULE)),
    supabase.from('etudiant').select('id, nom, prenom, email, date_entree, date_sortie_prevue, date_sortie_reelle, statut, archived, caution, bien:bien_id(code)').eq('agence', agence).eq('archived', false),
    supabase.from('caution_suivi').select('etudiant_id, statut, montant_recu, date_rendu').eq('agence', agence),
  ])
  // Caution reçue = montant enregistré (v2) OU un versement rapproché sur le compte cautions
  // (les cautions antérieures à la v2 n'ont pas de montant enregistré)
  const { data: versCautions } = await supabase.from('lld_mouvement_bancaire').select('etudiant_id')
    .eq('agence', agence).eq('statut', 'rapproche').not('etudiant_id', 'is', null).or('compte.eq.cautions,type_mouvement.eq.caution')
  const cautionVersee = new Set((versCautions || []).map(m => m.etudiant_id))
  const jour = Number(today.slice(8, 10))
  const enRetard = (loyers || []).filter(l => !l.etudiant?.archived && (l.mois < moisCourant || jour > (l.etudiant?.jour_paiement_attendu || 5) + 5))
  // Virement proprio à faire seulement si le loyer correspondant est encaissé
  const { data: recus } = await supabase.from('loyer_suivi').select('etudiant_id, mois').eq('agence', agence).eq('statut', 'recu').lte('mois', moisCourant)
  const recuSet = new Set((recus || []).map(r => `${r.etudiant_id}|${r.mois}`))
  const aVirer = (virements || []).filter(v => !v.etudiant?.archived && recuSet.has(`${v.etudiant?.id}|${v.mois}`))
  const cautionPar = new Map((cautions || []).map(c => [c.etudiant_id, c]))
  const dans = (d, j) => { const x = new Date(today + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + j); return d && String(d).slice(0, 10) <= x.toISOString().slice(0, 10) }
  const sortiesProches = (etudiants || []).filter(e => { const s = e.date_sortie_reelle || e.date_sortie_prevue; return s && s >= today && dans(s, 45) })
  // Restitution de caution : 1 mois après la remise des clés (état des lieux conforme),
  // 2 mois s'il y a des retenues (loi du 6 juillet 1989, art. 22) — au-delà, pénalité de 10 % du
  // loyer par mois de retard.
  const cautionsARendre = (etudiants || []).filter(e => {
    const s = e.date_sortie_reelle || e.date_sortie_prevue
    const c = cautionPar.get(e.id)
    return s && s < today && (!c || c.statut !== 'rendue') && (e.caution || c?.montant_recu)
  }).map(e => {
    const s = String(e.date_sortie_reelle || e.date_sortie_prevue).slice(0, 10)
    const lim = new Date(s + 'T12:00:00Z'); lim.setUTCMonth(lim.getUTCMonth() + 1)
    return { ...e, sortie: s, limite_restitution: lim.toISOString().slice(0, 10) }
  })
  const cautionsNonRecues = (etudiants || []).filter(e => e.caution > 0 && e.date_entree && e.date_entree <= today && !(cautionPar.get(e.id)?.montant_recu > 0) && !cautionVersee.has(e.id) && cautionPar.get(e.id)?.statut !== 'rendue')
  const sansEmail = (etudiants || []).filter(e => !e.email)

  return {
    loyers_en_retard: enRetard,
    paiements_a_confirmer: (mvts || []).filter(m => m.suggestion),
    paiements_non_reconnus: (mvts || []).filter(m => !m.suggestion),
    virements_proprio_a_faire: aVirer,
    sorties_proches: sortiesProches,
    cautions_a_rendre: cautionsARendre,
    cautions_non_recues: cautionsNonRecues,
    etudiants_sans_email: sansEmail,
  }
}

// ── Quittances : envoyées dès que le loyer est reçu — ce que faisait déjà le portail quand
// Laura marquait un loyer reçu, désormais sans clic. Uniquement pour un paiement reconnu avec
// CERTITUDE (ou rattaché à la main) : jamais sur une suggestion.
export async function envoyerQuittancesAuto(agence = AGENCE, { dryRun = false } = {}) {
  const { data: loyers, error } = await supabase.from('loyer_suivi')
    .select('id, mois, etudiant:etudiant_id(email, archived)')
    .eq('agence', agence).eq('statut', 'recu').is('quittance_envoyee_at', null).gte('mois', moisDe(BASCULE))
  if (error) throw error
  const ids = (loyers || []).map(l => l.id)
  if (!ids.length) return { envoyees: 0, a_envoyer: 0 }
  const { data: preuves } = await supabase.from('lld_mouvement_bancaire').select('loyer_suivi_id')
    .in('loyer_suivi_id', ids).in('match_confiance', ['certain', 'manuel'])
  const prouves = new Set((preuves || []).map(p => p.loyer_suivi_id))
  const cibles = (loyers || []).filter(l => prouves.has(l.id) && l.etudiant?.email && !l.etudiant?.archived)
  if (dryRun) return { envoyees: 0, a_envoyer: cibles.length }
  let envoyees = 0; const erreurs = []
  for (const l of cibles) {
    const { error: e } = await supabase.functions.invoke('generer-quittance', { body: { loyer_suivi_id: l.id, envoyer_email: true } })
    if (e) erreurs.push({ loyer_suivi_id: l.id, error: e.message }); else envoyees++
  }
  return { envoyees, a_envoyer: cibles.length, erreurs }
}

// ── Orchestration nocturne ─────────────────────────────────────────────────────────────
export async function lancerLLDAuto(agence = AGENCE, { dryRun = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const moisCourant = moisDe(today)
  const out = { agence, today, dry_run: dryRun }
  out.statuts = await promouvoirStatuts(agence, today, dryRun)
  // Loyers attendus : mois courant + 2 précédents (rattrapage), jamais avant la bascule
  const mois = [moisPlus(moisCourant, -2), moisPlus(moisCourant, -1), moisCourant].filter(m => m >= moisDe(BASCULE))
  out.mois_prepares = []
  let loyersVirtuels = null
  if (!dryRun) for (const m of mois) { await initialiserLoyersMois(m, agence); out.mois_prepares.push(m) }
  else {
    // Ce que initialiserLoyersMois créerait (mêmes règles : actif / en attente entré, présent)
    const tous = await listerEtudiants(agence, null, false)
    loyersVirtuels = []
    for (const m of mois) {
      const [y, mm] = m.split('-').map(Number)
      const fin = `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`
      for (const e of tous) {
        const eligible = (e.statut === 'actif' || (e.statut === 'en_attente' && e.date_entree && e.date_entree <= fin)) && prorataMois(e, m).facteur > 0
        if (eligible) loyersVirtuels.push({ id: `virtuel-${e.id}-${m}`, etudiant_id: e.id, mois: m, montant_attendu: montantTotalEtudiant(e, m), montant_recu: null, statut: 'attendu' })
      }
    }
    out.mois_prepares = mois.map(m => `${m} (simulé)`)
  }
  out.rapprochement = await rapprocherLLD(agence, { dryRun, loyersVirtuels })
  out.virements_proprio = dryRun ? null : await autoMatcherVirementsProprioLLD(agence)
  out.quittances = await envoyerQuittancesAuto(agence, { dryRun })
  out.factures = {}
  if (!dryRun) for (const m of [moisPlus(moisCourant, -1), moisCourant]) out.factures[m] = await genererFacturesLLD(m, agence)
  const af = await aFaireLLD(agence, today)
  out.a_faire = Object.fromEntries(Object.entries(af).map(([k, v]) => [k, v.length]))
  if (!dryRun) {
    const r = out.rapprochement
    await supabase.from('journal_ops').insert({
      categorie: 'lld', action: 'lld_auto', source: 'cron', statut: 'ok',
      message: `LLD ${agence} : ${r.loyers_recus} loyer(s) reçu(s), ${r.loyers_partiels} partiel(s), ${r.cautions} caution(s), ${r.frais} frais, ${r.suggestions} suggestion(s), ${r.non_reconnus} non reconnu(s) · à faire : ${Object.entries(out.a_faire).filter(([, n]) => n).map(([k, n]) => `${k}=${n}`).join(', ') || 'rien'}`,
    })
  }
  return { ...out, detail_a_faire: af }
}
