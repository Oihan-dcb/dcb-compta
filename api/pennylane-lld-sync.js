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
import { AGENCE } from '../src/lib/agence.js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
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

  try {
    const pennylaneRes = await fetch(`${SUPABASE_URL}/functions/v1/pennylane-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SRK}` },
      body: JSON.stringify({
        action: 'listTransactions',
        agency: 'DCB',
        payload: { limit: 100, filter: [{ field: 'bank_account_id', operator: 'eq', value: BANK_ACCOUNT_ID }] },
      }),
    })
    const { status, data } = await pennylaneRes.json()
    if (status !== 200) throw new Error(`Pennylane listTransactions échoué (${status}) : ${JSON.stringify(data)}`)

    const transactions = data.items || []

    // Même hypothèse de signe que pennylane-mouvement-sync.js (à confirmer sur données réelles)
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

    console.log(`[pennylane-lld-sync] ${AGENCE} — ${transactions.length} tx récupérées, ${inseres} importée(s), ${lies} lié(s), ${updated} loyer(s) maj`)

    return res.json({ ok: true, agence: AGENCE, fetched: transactions.length, inseres, lies, loyers: { updated, skipped } })
  } catch (err) {
    console.error('[pennylane-lld-sync] erreur:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
