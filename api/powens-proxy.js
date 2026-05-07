/**
 * Vercel API Route — Powens Proxy
 * Proxy sécurisé entre le frontend React et les Edge Functions Powens
 * Utilise SERVICE_ROLE_KEY (jamais exposé au navigateur)
 */

const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
const REDIRECT_URI = 'https://dcb-compta.vercel.app/api/powens-callback'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key manquante' })

  const { fn, ...body } = req.body
  if (!fn) return res.status(400).json({ error: 'fn requis' })

  // Injecter la redirectUri pour les appels auth
  if (body.action === 'init_webview') {
    body.redirectUri = REDIRECT_URI
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
