export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { action, ae_id, email, password, mois } = req.body
    if (!action || !ae_id) return res.status(400).json({ error: 'action et ae_id requis' })
    const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW5jY2h2eXBidHhrcGFsd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTE4NzIsImV4cCI6MjA4ODQ2Nzg3Mn0.jvPn6LkBfT1eeHmkGI-_vAD2pdM_Y0JWgtbJAG-DLjM'
    let slug, payload
    if (action === 'create') {
      slug = 'create-ae-user'; payload = { ae_id, email, password }
    } else if (action === 'reset') {
      slug = 'reset-ae-password'; payload = { ae_id, email, password }
    } else if (action === 'sync') {
      slug = 'sync-ical-ae'; payload = { ae_id, mois }
    } else {
      return res.status(400).json({ error: 'action invalide' })
    }
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