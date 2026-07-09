// api/pennylane-lld-sync.js — DCB Compta
// GET/POST /api/pennylane-lld-sync
//
// Cron (Vercel, nightly 3h55) : récupère les nouvelles transactions Pennylane du compte
// séquestre LLD "loyers" (CAISSE EPARGNE SEQUESTRE), les importe dans
// lld_mouvement_bancaire (remplace l'import CSV manuel pour ce compte), puis lance le
// matching automatique LLD.
//
// ZÉRO duplication : réutilise src/services/lldBanque.js (importerMouvementsLLD,
// autoMatcherMouvementsLLD, majLoyersDepuisVirements) — les mêmes fonctions
// qu'utilisait le bouton manuel Powens avant sa suppression.
//
// Compte Pennylane ciblé : CAISSE EPARGNE SEQUESTRE (id 14431420416) = sous-compte
// "loyers" UNIQUEMENT. Le sous-compte "cautions" est un compte bancaire distinct pas
// encore connecté à Pennylane (validé avec Oïhan le 06/07/2026) — reste sur import CSV
// manuel dans PageLocationsLongues jusqu'à nouvel ordre.

import { importerMouvementsLLD, autoMatcherMouvementsLLD, majLoyersDepuisVirements } from '../src/services/lldBanque.js'
import { fetchAllPennylaneTransactions } from '../src/services/pennylaneTransactions.js'
import { filtrerTransactionsDupliquees } from '../src/services/pennylaneDedup.js'
import { supabase } from '../src/lib/supabase.js'
import { AGENCE } from '../src/lib/agence.js'

const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET

const BANK_ACCOUNT_ID = '14431420416' // CAISSE EPARGNE SEQUESTRE (LLD loyers)
const COMPTE = 'loyers'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const isCronToken = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  if (!isCronToken) return res.status(401).json({ error: 'Non autorisé' })
  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })

  // Compte Pennylane ciblé (14431420416) = compte DCB uniquement. Pennylane n'est
  // connecté qu'à DCB pour l'instant (Lauïan n'a pas encore son propre compte séquestre
  // sur Pennylane) — ce cron tourne aussi sur le déploiement lauian-compta (même repo),
  // ce qui créait une course avec le cron dcb-compta : le déploiement le plus rapide
  // "gagnait" les nouvelles transactions et les taguait agence=lauian par erreur
  // (incident constaté le 09/07/2026, transactions Airbnb réelles DCB mal attribuées).
  if (AGENCE !== 'dcb') return res.status(200).json({ ok: true, skipped: 'pennylane_dcb_only', agence: AGENCE })

  try {
    const transactionsBrutes = await fetchAllPennylaneTransactions(BANK_ACCOUNT_ID, SUPABASE_SRK)

    // Garde-fou : évite les doublons avec un éventuel import CSV manuel resté actif sur
    // ce compte (voir incident du 07/07/2026 — 23 mouvements dupliqués sur ce compte).
    const { transactions, doublonsEvites } = await filtrerTransactionsDupliquees(supabase, {
      table: 'lld_mouvement_bancaire',
      agence: AGENCE,
      extraEq: { compte: COMPTE },
      transactions: transactionsBrutes,
    })
    if (doublonsEvites > 0) {
      console.warn(`[pennylane-lld-sync] ${doublonsEvites} doublon(s) évité(s) — un import CSV manuel semble encore actif sur ce compte, à vérifier.`)
    }

    // Convention de signe confirmée le 06/07/2026 sur données réelles de ce compte :
    // amount négatif = débit, positif = crédit.
    const rows = transactions
      .map(tx => {
        const montant = Number(tx.amount)
        if (!tx.date || !Number.isFinite(montant) || montant === 0) return null
        const estDebit = montant < 0
        const montantCentimes = Math.round(Math.abs(montant) * 100)
        return {
          numero_operation: `PENNYLANE_${tx.id}`,
          date_operation: tx.date,
          libelle: (tx.label || '').slice(0, 200),
          detail: '',
          debit: estDebit ? montantCentimes : null,
          credit: estDebit ? null : montantCentimes,
          mois_releve: tx.date.slice(0, 7),
        }
      })
      .filter(Boolean)

    const inseres = await importerMouvementsLLD(rows, COMPTE)
    const { lies } = await autoMatcherMouvementsLLD()
    const { updated, skipped } = await majLoyersDepuisVirements()

    console.log(`[pennylane-lld-sync] ${AGENCE} — ${transactionsBrutes.length} tx récupérées, ${doublonsEvites} doublon(s) évité(s), ${inseres} importée(s), ${lies} lié(s), ${updated} loyer(s) maj`)

    await supabase.from('import_log').insert({
      type: 'pennylane_lld_loyers',
      statut: doublonsEvites > 0 ? 'partial' : 'success',
      nb_lignes_traitees: transactionsBrutes.length,
      nb_lignes_creees: inseres,
      message: `${transactionsBrutes.length} tx récupérées, ${doublonsEvites} doublon(s) évité(s), ${inseres} importée(s), ${lies} lié(s)`,
    })

    return res.json({ ok: true, agence: AGENCE, fetched: transactionsBrutes.length, doublonsEvites, inseres, lies, loyers: { updated, skipped } })
  } catch (err) {
    console.error('[pennylane-lld-sync] erreur:', err.message)
    await supabase.from('import_log').insert({ type: 'pennylane_lld_loyers', statut: 'error', message: err.message }).catch(() => {})
    return res.status(500).json({ error: err.message })
  }
}
