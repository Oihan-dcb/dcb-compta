// api/pennylane-mouvement-sync.js — DCB Compta
// GET/POST /api/pennylane-mouvement-sync
//
// Cron (Vercel, nightly 3h50 — juste avant matching-auto 4h00) : récupère les nouvelles
// transactions Pennylane du compte séquestre location saisonnière, les importe dans
// mouvement_bancaire (remplace l'import CSV manuel pour ce compte), puis lance le
// matching automatique sur tous les mois touchés (backfill historique inclus).
//
// ZÉRO duplication : réutilise src/services/importBanque.js (detectCanal,
// importerMouvementsBancaires) et src/services/rapprochement.js (lancerMatchingAuto) —
// les mêmes moteurs que l'import CSV manuel et le cron nightly (api/matching-auto.js).
//
// Compte Pennylane ciblé : CAISSE EPARGNE LOCATION SAISONNIERE (id 14431436800) UNIQUEMENT.
// Les autres comptes (courant → factures d'achat, séquestre → LLD, Shine...) ne sont PAS
// touchés ici — voir la cartographie validée avec Oïhan le 06/07/2026.

import { detectCanal, importerMouvementsBancaires } from '../src/services/importBanque.js'
import { lancerMatchingAuto } from '../src/services/rapprochement.js'
import { fetchAllPennylaneTransactions } from '../src/services/pennylaneTransactions.js'
import { AGENCE } from '../src/lib/agence.js'

const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET // envoyé par Vercel en Authorization: Bearer sur les crons
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET // fallback secret partagé, comme matching-auto.js

const BANK_ACCOUNT_ID = '14431436800' // CAISSE EPARGNE LOCATION SAISONNIERE
const SOURCE = 'Pennylane_LOCATION_SAISONNIERE'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const isCronToken = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  if (!isCronToken) return res.status(401).json({ error: 'Non autorisé' })
  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })

  try {
    const transactions = await fetchAllPennylaneTransactions(BANK_ACCOUNT_ID, SUPABASE_SRK)

    // Convention de signe confirmée le 06/07/2026 sur données réelles (compte SEQUESTRE) :
    // amount négatif = débit, positif = crédit.
    const rows = transactions
      .map(tx => {
        const montant = Number(tx.amount)
        if (!tx.date || !Number.isFinite(montant) || montant === 0) return null
        const estDebit = montant < 0
        const montantCentimes = Math.round(Math.abs(montant) * 100)
        const lib = (tx.label || '').slice(0, 200)
        return {
          numero_operation: `PENNYLANE_${tx.id}`,
          date_operation: tx.date,
          libelle: lib,
          detail: '',
          debit: estDebit ? montantCentimes : null,
          credit: estDebit ? null : montantCentimes,
          canal: detectCanal(lib, '', estDebit ? montantCentimes : 0),
          source: SOURCE,
          mois_releve: tx.date.slice(0, 7),
          statut_matching: 'en_attente',
        }
      })
      .filter(Boolean)

    const importLog = await importerMouvementsBancaires(rows)

    // Matching sur tous les mois touchés par l'import (backfill historique possible),
    // plus le mois courant même si rien de nouveau (mouvements en_attente déjà présents).
    const now = new Date()
    const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const moisAtraiter = new Set([moisCourant, ...rows.map(r => r.mois_releve)])

    const matchResults = {}
    for (const mois of moisAtraiter) {
      const log = await lancerMatchingAuto(mois, 'pennylane')
      matchResults[mois] = { matched: log.matched, skipped: log.skipped, errors: log.errors }
    }

    console.log(`[pennylane-mouvement-sync] ${AGENCE} — ${transactions.length} tx récupérées, ${importLog.inseres} importée(s), mois traités: ${[...moisAtraiter].join(',')}`)

    return res.json({ ok: true, agence: AGENCE, fetched: transactions.length, import: importLog, matching: matchResults })
  } catch (err) {
    console.error('[pennylane-mouvement-sync] erreur:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
