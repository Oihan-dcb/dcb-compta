// api/sequestre-justificatif.js — DCB Compta
// Cron quotidien (05:20, après imports bancaires, ventilation et rapprochements de la nuit) :
// justificatif du séquestre location saisonnière (I-161) — photo du jour dans
// sequestre_justificatif + publication des anomalies dans alerte_etat (source 'sequestre') → Point du matin.
//   GET /api/sequestre-justificatif            → calcul + enregistrement + publication
//   GET /api/sequestre-justificatif?dry_run=1  → calcul seul
// Multi-agence (migration 278) : chaque agence ayant une fiche sequestre_compte active. Exécuté une
// seule fois, par le projet dcb-compta (lauian-compta déploie le même vercel.json : ignoré là-bas).
// Écrit aussi le grand livre des mandants (sequestre_ecriture) de l'agence.

import { justifierSequestre } from '../src/services/sequestreJustificatif.js'
import { AGENCE } from '../src/lib/agence.js'
import { supabase } from '../src/lib/supabase.js'
import { journaliser, listerClotures, verifierClotures } from '../src/services/sequestreCloture.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

// Bouton « Recalculer maintenant » (page Séquestre, 07/10/2026) : le calcul tourne ICI, comme celui de la
// nuit, et plus dans le navigateur — exécuté côté client il donnait d'autres résultats que le serveur
// (liens de paiement perdus : 8 063,58 € puis 44 935,43 € « à affecter », septembre à −42 k€) alors que
// le calcul serveur était juste. Accès : utilisateur bureau (JWT Supabase vérifié par auth_user_is_bureau).
async function estBureau(token) {
  if (!token || !SUPABASE_ANON_KEY) return null
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_user_is_bureau`, {
    method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
  })
  if (!r.ok) return null
  if ((await r.json()) !== true) return null
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } })
  return u.ok ? ((await u.json())?.email || 'bureau') : 'bureau'
}
// Seuils (audit des mails 09/10/2026 — le mail partait presque chaque jour) :
// · SEUIL_VARIATION 50 € : en dessous, une variation d'écart d'un jour à l'autre vient des arrondis / frais
//   Stripe en cours d'import (écart DCB stable entre 0 et -0,79 € du 01 au 09/10) ; journalisée au-delà.
// · SEUIL_ECART_ALERTE 50 € : un écart absolu au-delà est publié ; il redevient « nouveau » à chaque
//   franchissement d'une tranche de 50 € (clé ecart:<tranche>), sinon il reste une ligne « toujours ouvert ».
// · SEUIL_PART_AGENCE 50 € : écart mensuel de part agence publié seulement au-delà (Lauïan août -5,10 €,
//   février +48,87 € : bruit d'arrondi, toujours visible sur la page Séquestre).
// La vraie cause du mail quotidien n'était pas ce seuil mais (1) des clés d'anomalie qui changeaient chaque
// jour (date de relevé, compteur, montant) et (2) les « dérives » des mois clôturés renvoyées chaque nuit à
// l'identique — corrigés dans sequestreJustificatif.js / sequestreCloture.js ; ici la mémoire alerte_etat
// ne re-signale que le nouveau.
const SEUIL_VARIATION = 5000
const SEUIL_ECART_ALERTE = 5000
const SEUIL_PART_AGENCE = 5000

const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const parCron = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  const auteurManuel = parCron ? null : await estBureau(token)
  if (!parCron && !auteurManuel) return res.status(401).json({ error: 'Non autorisé' })
  // Cron : exécuté une seule fois, par dcb-compta. Recalcul manuel : l'agence de la page appelante.
  if (parCron && AGENCE !== 'dcb') return res.status(200).json({ ok: true, skipped: 'execute_par_dcb_compta', agence: AGENCE })

  const dryRun = req.query?.dry_run === '1'
  const { data: comptes } = await supabase.from('sequestre_compte').select('agence').eq('actif', true)
  const agences = req.query?.agence ? [req.query.agence] : auteurManuel ? [AGENCE] : (comptes || []).map(c => c.agence)
  const resultats = []
  for (const agence of agences) {
    try { resultats.push(await traiterAgence(agence, dryRun, auteurManuel)) }
    catch (err) {
      console.error('[sequestre-justificatif]', agence, err.message)
      await supabase.from('journal_ops').insert({ categorie: 'banque', action: 'sequestre_justificatif', source: 'cron', statut: 'error', message: `${agence} : ${err.message}` }).then(() => {}, () => {})
      resultats.push({ agence, error: err.message })
    }
  }
  return res.status(resultats.some(r => r.error) ? 500 : 200).json({ ok: !resultats.some(r => r.error), resultats })
}

// Progression lue par la page (migration 339) : écrite au plus toutes les 700 ms, jamais bloquante
function suiviProgres(agence, auteur) {
  let dernier = 0
  const ecrire = (champs) => supabase.from('sequestre_calcul_progres').upsert({ agence, maj: new Date().toISOString(), ...champs }, { onConflict: 'agence' }).then(() => {}, () => {})
  return {
    debut: () => ecrire({ pct: 0, etape: 'Démarrage', auteur, debut: new Date().toISOString(), termine: false, erreur: null }),
    maj: (pct, etape) => { const t = Date.now(); if (t - dernier < 700 && pct < 100) return; dernier = t; ecrire({ pct, etape }) },
    fin: (erreur = null) => ecrire({ pct: 100, etape: erreur ? 'Erreur' : 'Terminé', termine: true, erreur }),
  }
}

async function traiterAgence(agence, dryRun, auteurManuel = null) {
  const suivi = suiviProgres(agence, auteurManuel || 'cron')
  await suivi.debut()
  try {
    const r = await traiterAgenceCalcul(agence, dryRun, auteurManuel, suivi)
    await suivi.fin()
    return r
  } catch (e) { await suivi.fin(e.message); throw e }
}

async function traiterAgenceCalcul(agence, dryRun, auteurManuel, suivi) {
  {
    const j = await justifierSequestre(agence, { onProgress: suivi.maj })
    suivi.maj(92, 'Enregistrement de la photo du jour')
    if (dryRun) return { agence, dry_run: true, ecart: j.ecart, ecart_import: j.ecart_import, a_affecter: j.ecritures.filter(x => x.ayant_droit === 'a_affecter').length }

    const { data: precedent } = await supabase.from('sequestre_justificatif')
      .select('date, ecart, detail').eq('agence', agence).lt('date', j.date).order('date', { ascending: false }).limit(1).maybeSingle()
    const { error } = await supabase.from('sequestre_justificatif').upsert({
      agence, date: j.date, solde_banque: j.solde_banque.montant, solde_maj: j.solde_banque.maj,
      total_justifie: j.total_justifie, ecart: j.ecart, poches: j.poches, par_mois: j.par_mois,
      detail: { ...j.detail, anomalies: j.anomalies, anomalies_archivees: j.anomalies_archivees || [], ecart_import: j.ecart_import, banque: j.solde_banque.banque },
    }, { onConflict: 'agence,date' })
    if (error) throw error
    // Grand livre : recalculé intégralement (dérivé du relevé + affectations + alias)
    suivi.maj(95, 'Enregistrement du grand livre')
    const { error: eDel } = await supabase.from('sequestre_ecriture').delete().eq('agence', agence)
    if (eDel) throw eDel
    for (let i = 0; i < j.ecritures.length; i += 500) {
      const { error: eIns } = await supabase.from('sequestre_ecriture').insert(j.ecritures.slice(i, i + 500))
      if (eIns) throw eIns
    }

    const clesAvant = new Set((precedent?.detail?.anomalies || []).map(a => a.cle))
    const nouvelles = j.anomalies.filter(a => !clesAvant.has(a.cle))
    const clesMaintenant = new Set(j.anomalies.map(a => a.cle))
    const clesArchivees = new Set((j.anomalies_archivees || []).map(a => a.cle))
    const resolues = (precedent?.detail?.anomalies || []).filter(a => !clesMaintenant.has(a.cle) && !clesArchivees.has(a.cle))
    const aBouge = precedent && Math.abs(j.ecart - precedent.ecart) > SEUIL_VARIATION

    // Journal (migration 283) : photo du jour, variation, anomalies apparues / résolues
    await journaliser(agence, 'calcul', `${auteurManuel ? `Recalcul manuel (${auteurManuel})` : 'Calcul de nuit'} : solde ${eur(j.solde_banque.montant)}, justifié ${eur(j.total_justifie)}, écart ${eur(j.ecart)}, ${j.anomalies.length} anomalie(s)`,
      { montant: j.ecart, auteur: auteurManuel || 'cron', detail: { ecart_import: j.ecart_import, a_affecter: j.ecritures.filter(x => x.ayant_droit === 'a_affecter').length } })
    if (aBouge) await journaliser(agence, 'variation_ecart', `L'écart a bougé de ${j.ecart - precedent.ecart > 0 ? '+' : ''}${eur(j.ecart - precedent.ecart)} depuis le ${String(precedent.date).split('-').reverse().join('/')} (${eur(precedent.ecart)} → ${eur(j.ecart)})`,
      { montant: j.ecart - precedent.ecart, auteur: 'cron' })
    for (const a of nouvelles) await journaliser(agence, 'anomalie_nouvelle', a.message, { mois: a.mois || null, montant: a.montant ?? null, auteur: 'cron', detail: { cle: a.cle } })
    for (const a of resolues) await journaliser(agence, 'anomalie_resolue', `Résolue : ${a.message}`, { mois: a.mois || null, montant: a.montant ?? null, auteur: 'cron', detail: { cle: a.cle } })

    // Dérive des mois clôturés (recalcul à la date d'arrêté des 3 derniers mois clôturés)
    suivi.maj(97, 'Vérification des mois clôturés')
    let derives = []
    try { derives = await verifierClotures(agence, await listerClotures(agence), { max: 3 }) } catch (e) { console.error('[verifierClotures]', e.message) }
    for (const d of derives) await journaliser(agence, 'derive_mois_cloture', `Mois clôturé ${d.mois} modifié après coup : ${d.champ} ${eur(d.avant)} → ${eur(d.apres)} (${d.delta > 0 ? '+' : ''}${eur(d.delta)})`,
      { mois: d.mois, montant: d.delta, auteur: 'cron', detail: d })

    // Publication pour le Point du matin (la nuit seulement — un recalcul manuel ne doit pas clôturer/ouvrir)
    let alerte = { publie: false }
    if (!auteurManuel) {
      const AG = agence === 'dcb' ? 'DCB' : agence === 'lauian' ? 'Lauïan' : agence
      const items = j.anomalies
        .filter(a => !(a.cle.startsWith('dcb_') && Math.abs(a.montant || 0) < SEUIL_PART_AGENCE))
        .map(a => ({ cle: a.cle, libelle: `Séquestre ${AG} — ${a.message}`, montant_cts: Math.abs(a.montant || 0), detail: { mois: a.mois || null } }))
      if (Math.abs(j.ecart) > SEUIL_ECART_ALERTE) items.push({
        cle: `ecart:${Math.sign(j.ecart)}${Math.floor(Math.abs(j.ecart) / SEUIL_ECART_ALERTE)}`,
        libelle: `Séquestre ${AG} — écart de ${eur(j.ecart)} entre le solde bancaire (${eur(j.solde_banque.montant)}) et le justifié (${eur(j.total_justifie)})`,
        montant_cts: Math.abs(j.ecart),
      })
      for (const d of derives) items.push({
        cle: `derive_${d.mois}_${d.champ}_${d.apres}`,
        libelle: `Séquestre ${AG} — mois clôturé ${d.mois} modifié après coup : ${d.champ} ${eur(d.avant)} → ${eur(d.apres)} (${d.delta > 0 ? '+' : ''}${eur(d.delta)})`,
        montant_cts: Math.abs(d.delta), detail: { mois: d.mois },
      })
      const { data: pub, error: ePub } = await supabase.rpc('alerte_signaler', { p_source: 'sequestre', p_agence: agence, p_items: items, p_complet: true })
      alerte = ePub ? { publie: false, erreur: ePub.message } : { publie: true, ...pub, variation: precedent ? j.ecart - precedent.ecart : null }
    }
    await supabase.from('journal_ops').insert({ categorie: 'banque', action: 'sequestre_justificatif', source: 'cron', statut: Math.abs(j.ecart) > 100 ? 'warning' : 'ok',
      message: `Séquestre ${agence} ${j.date} : solde ${eur(j.solde_banque.montant)}, justifié ${eur(j.total_justifie)}, écart ${eur(j.ecart)}, ${j.anomalies.length} anomalie(s)` })
    return { agence, date: j.date, solde: j.solde_banque.montant, justifie: j.total_justifie, ecart: j.ecart, ecart_import: j.ecart_import, anomalies: j.anomalies.length,
      ecritures: j.ecritures.length, a_affecter: j.ecritures.filter(x => x.ayant_droit === 'a_affecter').length, alerte }
  }
}
