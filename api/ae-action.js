const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const { action, ae_id, email, password, mois } = req.body
    if (!action || !ae_id) return res.status(400).json({ error: 'action et ae_id requis' })
    const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
    const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
    let slug, payload
    if (action === 'create') { slug = 'create-ae-user'; payload = { ae_id, email, password } }
    else if (action === 'reset') { slug = 'reset-ae-password'; payload = { ae_id, email, password } }
    else if (action === 'sync') { slug = 'sync-ical-ae'; payload = { ae_id, mois } }
    else return res.status(400).json({ error: 'action invalide' })
    const fnResp = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await fnResp.json()
    return res.status(fnResp.ok ? 200 : 500).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
