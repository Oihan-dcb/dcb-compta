// POST { action, ae_id, email?, mois? }
// Proxy vers les Edge Functions Supabase : create-ae-user, reset-ae-password, sync-ical-ae
// Requis : JWT Supabase valide + email dans ALLOWED_ADMIN_EMAILS

const SUPABASE_URL    = 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const ALLOWED_EMAILS  = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

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

  try {
    const { action, ae_id, email: aeEmail, mois } = req.body
    if (!action || !ae_id) return res.status(400).json({ error: 'action et ae_id requis' })

    let slug, payload
    if (action === 'create') { slug = 'create-ae-user'; payload = { ae_id, email: aeEmail } }
    else if (action === 'reset') { slug = 'reset-ae-password'; payload = { ae_id } }
    else if (action === 'sync') { slug = 'sync-ical-ae'; payload = { ae_id, mois } }
    else return res.status(400).json({ error: 'action invalide' })

    // Appel Edge Function avec service role (jamais exposé au navigateur)
    const fnResp = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await fnResp.json()
    return res.status(fnResp.ok ? 200 : 500).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
