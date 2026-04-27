// POST { ae_user_id } → proxy vers dcb-planning/api/messagerie-create-staff-room (server-side, pas de CORS)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
