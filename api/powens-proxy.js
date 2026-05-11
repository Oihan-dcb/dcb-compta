/**
 * Vercel API Route — Powens Proxy
 * Proxy sécurisé entre le frontend React et les Edge Functions Powens
 * Utilise SERVICE_ROLE_KEY (jamais exposé au navigateur)
 */

const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
const REDIRECT_URI = 'https://dcb-compta.vercel.app/api/powens-callback'
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET

const FN_ALLOWLIST = ['powens-auth', 'powens-sync']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key manquante' })

  const { fn, ...body } = req.body
  if (!fn) return res.status(400).json({ error: 'fn requis' })

  if (!FN_ALLOWLIST.includes(fn)) {
    return res.status(400).json({ error: `fn non autorisé : ${fn}` })
  }

  // Injecter la redirectUri avec agence+accountLabel pour que le callback sache quel compte traiter
  if (body.action === 'init_webview') {
    const params = new URLSearchParams({ agence: body.agence || 'dcb', account_label: body.accountLabel || 'seq_lc' })
    body.redirectUri = `${REDIRECT_URI}?${params}`
  }

  try {
    const fnRes = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await fnRes.json()
    return res.status(fnRes.ok ? 200 : fnRes.status).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
