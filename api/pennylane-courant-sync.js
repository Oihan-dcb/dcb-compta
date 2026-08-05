// api/pennylane-courant-sync.js — DCB Compta
// GET/POST /api/pennylane-courant-sync
//
// Cron (Vercel, nightly) : récupère les nouvelles transactions Pennylane du compte
// CAISSE EPARGNE COURANT (celui où atterrissent les paiements HON/FMEN/débours des
// propriétaires, les achats fournisseurs, la paie, etc. — PAS les payins voyageurs).
//
// GARDE-FOU CRITIQUE — ne jamais mélanger avec le compte séquestre location
// saisonnière (voir api/pennylane-mouvement-sync.js) :
//   - source = 'Powens_courant' (convention DÉJÀ établie et déjà exclue explicitement
//     de src/services/banque.js:getMouvementsMois, qui alimente lancerMatchingAuto —
//     ces mouvements ne peuvent donc jamais être proposés comme preuve de paiement
//     d'une réservation voyageur, quel que soit leur canal détecté).
//   - C'est aussi la source déjà attendue par l'onglet Achats (PageAchats.jsx) pour
//     afficher/rapprocher les factures fournisseurs — ce cron alimente une UI qui
//     existait déjà mais n'avait jamais reçu de données réelles.
//   - statut_matching reste 'en_attente' (comportement standard importerMouvementsBancaires) :
//     ça permet à matcherDeboursProprietaires (canal sepa_manuel/interne, nom + montant
//     exact — flux indépendant du matching résa) de continuer à fonctionner sur ces
//     mouvements, ce qui est légitime : les remboursements de débours AE des
//     propriétaires atterrissent bien sur CE compte.
//
// Compte Pennylane ciblé : CAISSE EPARGNE COURANT (id 14431211520) UNIQUEMENT.

import { detectCanal, importerMouvementsBancaires } from '../src/services/importBanque.js'
import { matcherDeboursProprietaires } from '../src/services/rapprochement.js'
import { fetchAllPennylaneTransactions } from '../src/services/pennylaneTransactions.js'
import { filtrerTransactionsDupliquees } from '../src/services/pennylaneDedup.js'
import { supabase } from '../src/lib/supabase.js'
import { AGENCE } from '../src/lib/agence.js'

const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET

const BANK_ACCOUNT_ID = '14431211520' // CAISSE EPARGNE COURANT
const SOURCE = 'Powens_courant'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const isCronToken = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  if (!isCronToken) return res.status(401).json({ error: 'Non autorisé' })
  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })

  // Ce cron tourne aussi sur le déploiement lauian-compta (même repo, même vercel.json —
  // voir pennylane-mouvement-sync.js). Lauïan n'a pas de token Pennylane configuré du tout
  // (vérifié 2026-08-05) — skip propre plutôt qu'une erreur à chaque exécution.
  if (AGENCE !== 'dcb') return res.status(200).json({ ok: true, skipped: 'pennylane_dcb_only', agence: AGENCE })

  try {
    const transactionsBrutes = await fetchAllPennylaneTransactions(BANK_ACCOUNT_ID, SUPABASE_SRK)

    // Garde-fou doublons : même mécanique que le compte séquestre.
    const { transactions, doublonsEvites } = await filtrerTransactionsDupliquees(supabase, {
      table: 'mouvement_bancaire',
      agence: AGENCE,
      transactions: transactionsBrutes,
    })

    // Convention de signe identique au compte séquestre : amount négatif = débit, positif = crédit.
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

    // Rapprochement débours propriétaire — flux légitime sur ce compte (remboursements
    // AE des propriétaires). Ne touche jamais le matching résa (getMouvementsMois exclut
    // déjà ce `source`).
    const { lies: deboursLies } = await matcherDeboursProprietaires(AGENCE)

    console.log(`[pennylane-courant-sync] ${AGENCE} — ${transactionsBrutes.length} tx récupérées, ${doublonsEvites} doublon(s) évité(s), ${importLog.inseres} importée(s), ${deboursLies} débours rapproché(s)`)

    await supabase.from('import_log').insert({
      type: 'pennylane_courant',
      agence: AGENCE,
      statut: doublonsEvites > 0 ? 'partial' : 'success',
      nb_lignes_traitees: transactionsBrutes.length,
      nb_lignes_creees: importLog.inseres,
      message: `${transactionsBrutes.length} tx récupérées, ${doublonsEvites} doublon(s) évité(s), ${importLog.inseres} importée(s), ${deboursLies} débours rapproché(s)`,
    })

    return res.json({ ok: true, agence: AGENCE, fetched: transactionsBrutes.length, doublonsEvites, import: importLog, deboursLies })
  } catch (err) {
    console.error('[pennylane-courant-sync] erreur:', err.message)
    await supabase.from('import_log').insert({ type: 'pennylane_courant', agence: AGENCE, statut: 'error', message: err.message }).catch(() => {})
    return res.status(500).json({ error: err.message })
  }
}
