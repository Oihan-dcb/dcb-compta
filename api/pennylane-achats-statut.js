// api/pennylane-achats-statut.js — DCB Compta
// GET/POST /api/pennylane-achats-statut
//
// Cron (Vercel, nightly 4h05) : pour chaque facture_achat déjà poussée vers Pennylane
// (pennylane_document_id renseigné) et pas encore marquée payée, interroge le statut
// de paiement Pennylane (GET /supplier_invoices/{id}, champ `paid`) et remonte le
// résultat en local.
//
// Pas de matching maison : le compte courant est déjà connecté côté Pennylane et sa
// réconciliation bancaire native fait le travail — on ne fait que lire le résultat.

import { supabase } from '../src/lib/supabase.js'
import { AGENCE } from '../src/lib/agence.js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const isCronToken = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  if (!isCronToken) return res.status(401).json({ error: 'Non autorisé' })
  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })

  try {
    const { data: factures, error } = await supabase
      .from('facture_achat')
      .select('id, pennylane_document_id')
      .eq('agence', 'dcb')
      .not('pennylane_document_id', 'is', null)
      .eq('pennylane_paye', false)
    if (error) throw error

    let verifiees = 0, payees = 0, erreurs = 0

    for (const f of (factures || [])) {
      verifiees++
      try {
        const res2 = await fetch(`${SUPABASE_URL}/functions/v1/pennylane-proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SRK}` },
          body: JSON.stringify({ action: 'getSupplierInvoice', agency: 'DCB', payload: { invoiceId: f.pennylane_document_id } }),
        })
        const { status, data } = await res2.json()
        if (status !== 200) { erreurs++; continue }
        if (data.paid === true) {
          await supabase.from('facture_achat')
            .update({ pennylane_paye: true, pennylane_date_paiement: new Date().toISOString().slice(0, 10) })
            .eq('id', f.id)
          payees++
        }
      } catch {
        erreurs++
      }
    }

    console.log(`[pennylane-achats-statut] ${AGENCE} — ${verifiees} vérifiée(s), ${payees} passée(s) payée(s), ${erreurs} erreur(s)`)

    return res.json({ ok: true, agence: AGENCE, verifiees, payees, erreurs })
  } catch (err) {
    console.error('[pennylane-achats-statut] erreur:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
