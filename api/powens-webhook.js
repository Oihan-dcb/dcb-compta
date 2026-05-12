/**
 * Vercel API Route — Powens Webhook
 * Reçoit les événements Powens (ACCOUNT_SYNCED, etc.)
 * et déclenche automatiquement sync + import pour le compte concerné.
 *
 * Authentification : token secret dans l'URL query string
 * URL à enregistrer dans Powens : .../api/powens-webhook?secret=<POWENS_WEBHOOK_SECRET>
 * Powens ne supporte pas la signature HMAC native.
 */

import { timingSafeEqual } from 'crypto'

const SUPABASE_URL          = 'https://omuncchvypbtxkpalwcr.supabase.co'
const POWENS_WEBHOOK_SECRET = process.env.POWENS_WEBHOOK_SECRET

// Mapping powens_account_id → account_label
const ACCOUNT_MAP = {
  '10': { agence: 'dcb', accountLabel: 'courant' },
  '11': { agence: 'dcb', accountLabel: 'seq_lld' },
  '12': { agence: 'dcb', accountLabel: 'seq_lc' },
}

function verifySecret(received, expected) {
  // Comparaison timing-safe pour éviter les timing attacks
  try {
    const a = Buffer.from(received || '', 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key manquante' })

  // Vérifier le token secret dans l'URL (?secret=...)
  if (!POWENS_WEBHOOK_SECRET) {
    console.error('powens-webhook: POWENS_WEBHOOK_SECRET non configuré — webhook rejeté')
    return res.status(500).json({ error: 'Webhook secret non configuré' })
  }

  const receivedSecret = req.query?.secret || ''
  if (!verifySecret(receivedSecret, POWENS_WEBHOOK_SECRET)) {
    console.warn('powens-webhook: secret invalide — requête rejetée')
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const event = req.body

  // Powens envoie directement {id, name, ...} sans wrapper event_type
  const eventType = event?.event || event?.type || 'ACCOUNT_SYNCED'

  if (eventType !== 'ACCOUNT_SYNCED') {
    return res.status(200).json({ ignored: true, event: eventType })
  }

  const accountId = String(event?.id || event?.account?.id || event?.id_account || '')
  const mapping   = ACCOUNT_MAP[accountId]

  if (!mapping) {
    return res.status(200).json({ ignored: true, reason: `account ${accountId} non mappé` })
  }

  const { agence, accountLabel } = mapping

  try {
    const today       = new Date()
    const moisCourant = today.toISOString().substring(0, 7)
    const [y, m]      = moisCourant.split('-').map(Number)
    const dateFrom    = `${moisCourant}-01`
    const dateTo      = new Date(y, m, 0).toISOString().substring(0, 10)

    const syncRes = await fetch(`${SUPABASE_URL}/functions/v1/powens-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_transactions', agence, accountLabel, dateFrom, dateTo }),
    })
    const syncData = await syncRes.json()

    const importRes = await fetch(`${SUPABASE_URL}/functions/v1/powens-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import_staged', agence, accountLabel, mois: moisCourant }),
    })
    const importData = await importRes.json()

    console.log(`powens-webhook account=${accountId}(${accountLabel}) synced=${syncData.synced} new=${syncData.new} imported=${importData.importe} matched=${importData.matched ?? 0} loyersUpdated=${importData.loyersUpdated ?? 0} virementsLies=${importData.virementsLies ?? 0} errors=${(importData.erreurs || []).length}`)

    return res.status(200).json({
      ok: true,
      event: eventType,
      account: accountId,
      accountLabel,
      synced: syncData.synced,
      new: syncData.new,
      imported: importData.importe,
      matched: importData.matched ?? 0,
      loyersUpdated: importData.loyersUpdated ?? 0,
      virementsLies: importData.virementsLies ?? 0,
      importErrors: importData.erreurs,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
