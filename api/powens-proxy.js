/**
 * Vercel API Route — Powens Proxy
 * Proxy sécurisé entre le frontend React et les Edge Functions Powens
 * Requis : JWT Supabase valide + email dans ALLOWED_ADMIN_EMAILS
 */

const SUPABASE_URL    = 'https://omuncchvypbtxkpalwcr.supabase.co'
const REDIRECT_URI    = 'https://dcb-compta.vercel.app/api/powens-callback'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const ALLOWED_EMAILS  = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

const FN_ALLOWLIST = ['powens-auth', 'powens-sync']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // 1. Vérifier JWT Supabase
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Token manquant' })
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  })
  if (!authRes.ok) return res.status(401).json({ error: 'Non authentifié' })
  const { email } = await authRes.json()

  // 2. Vérifier que l'email est admin
  if (!ALLOWED_EMAILS.length) return res.status(500).json({ error: 'ALLOWED_ADMIN_EMAILS non configuré' })
  if (!ALLOWED_EMAILS.includes((email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Accès refusé' })
  }

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
