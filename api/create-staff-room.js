// POST { ae_user_id } → proxy vers dcb-planning/api/messagerie-create-staff-room (server-side, pas de CORS)
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

  const { ae_user_id } = req.body || {}
  if (!ae_user_id) return res.status(400).json({ error: 'ae_user_id requis' })

  const r = await fetch('https://dcb-planning.vercel.app/api/messagerie-create-staff-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ae_user_id }),
  })
  const data = await r.json()
  return res.status(r.ok ? 200 : r.status).json(data)
}
