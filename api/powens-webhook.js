/**
 * Vercel API Route — Powens Webhook
 * Reçoit les événements Powens (ACCOUNT_SYNCED, etc.)
 * et déclenche automatiquement sync + import pour le compte concerné.
 *
 * Signature : HMAC-SHA256 du raw body avec POWENS_WEBHOOK_SECRET
 * Header attendu : X-Powens-Signature: sha256=<hex>
 * (configurable dans le dashboard Powens → Webhooks → Secret)
 */

import { createHmac, timingSafeEqual } from 'crypto'

// Désactiver le body parser Vercel — on a besoin du raw body pour vérifier le HMAC
export const config = { api: { bodyParser: false } }

const SUPABASE_URL          = 'https://omuncchvypbtxkpalwcr.supabase.co'
const POWENS_WEBHOOK_SECRET = process.env.POWENS_WEBHOOK_SECRET

// Mapping powens_account_id → account_label
const ACCOUNT_MAP = {
  '10': { agence: 'dcb', accountLabel: 'courant' },
  '11': { agence: 'dcb', accountLabel: 'seq_lld' },
  '12': { agence: 'dcb', accountLabel: 'seq_lc' },
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function verifySignature(rawBody, header, secret) {
  // Format attendu : "sha256=<hex>" — même convention que GitHub / Stripe
  if (!header) return false
  const received = header.startsWith('sha256=') ? header.slice(7) : header
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    // timingSafeEqual lève si les buffers ont des longueurs différentes
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key manquante' })

  // Lire le raw body avant tout
  const rawBody = await readRawBody(req)

  // Vérifier la signature Powens
  if (!POWENS_WEBHOOK_SECRET) {
    console.error('powens-webhook: POWENS_WEBHOOK_SECRET non configuré — webhook rejeté')
    return res.status(500).json({ error: 'Webhook secret non configuré' })
  }

  const sigHeader = req.headers['x-powens-signature'] || req.headers['x-signature'] || ''
  if (!verifySignature(rawBody, sigHeader, POWENS_WEBHOOK_SECRET)) {
    console.warn('powens-webhook: signature invalide — requête rejetée')
    return res.status(401).json({ error: 'Signature invalide' })
  }

  // Parser le body après vérification
  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return res.status(400).json({ error: 'Payload JSON invalide' })
  }

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
