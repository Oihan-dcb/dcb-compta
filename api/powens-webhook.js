/**
 * Vercel API Route — Powens Webhook
 * Reçoit les événements Powens (ACCOUNT_SYNCED, etc.)
 * et déclenche automatiquement sync + import pour le compte concerné
 */

const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'

// Mapping powens_account_id → account_label
const ACCOUNT_MAP = {
  '10': { agence: 'dcb', accountLabel: 'courant' },
  '11': { agence: 'dcb', accountLabel: 'seq_lld' },
  '12': { agence: 'dcb', accountLabel: 'seq_lc' },
}

export default async function handler(req, res) {
  // Powens envoie des POST
  if (req.method !== 'POST') return res.status(405).end()

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key manquante' })

  const event = req.body
  const eventType = event?.event || event?.type

  // On ne traite que ACCOUNT_SYNCED
  if (eventType !== 'ACCOUNT_SYNCED') {
    return res.status(200).json({ ignored: true, event: eventType })
  }

  // Identifier le compte concerné
  const accountId = String(event?.account?.id || event?.id_account || '')
  const mapping = ACCOUNT_MAP[accountId]

  if (!mapping) {
    return res.status(200).json({ ignored: true, reason: `account ${accountId} non mappé` })
  }

  const { agence, accountLabel } = mapping

  try {
    // Déclencher le sync via l'edge function
    const today = new Date()
    const moisCourant = today.toISOString().substring(0, 7)
    const [y, m] = moisCourant.split('-').map(Number)
    const dateFrom = `${moisCourant}-01`
    const dateTo   = new Date(y, m, 0).toISOString().substring(0, 10)

    const syncRes = await fetch(`${SUPABASE_URL}/functions/v1/powens-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_transactions', agence, accountLabel, dateFrom, dateTo }),
    })
    const syncData = await syncRes.json()

    // Import automatique des transactions récupérées
    const importRes = await fetch(`${SUPABASE_URL}/functions/v1/powens-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import_staged', agence, accountLabel, mois: moisCourant }),
    })
    const importData = await importRes.json()

    return res.status(200).json({
      ok: true,
      event: eventType,
      account: accountId,
      accountLabel,
      synced: syncData.synced,
      new: syncData.new,
      imported: importData.importe,
      importErrors: importData.erreurs,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
