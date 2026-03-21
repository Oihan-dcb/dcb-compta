export default async function handler(req, res) {
  // CORS pour dcb-compta
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, ae_id, email, password } = req.body
  if (!action || !ae_id || !email || !password) {
    return res.status(400).json({ error: 'action, ae_id, email, password requis' })
  }

  const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW5jY2h2eXBidHhrcGFsd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTE4NzIsImV4cCI6MjA4ODQ2Nzg3Mn0.jvPn6LkBfT1eeHmkGI-_vAD2pdM_Y0JWgtbJAG-DLjM'

  const slug = action === 'create' ? 'create-ae-user' : 'reset-ae-password'

  try {
    const fnResp = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ae_id, email, password })
    })
    const data = await fnResp.json()
    return res.status(fnResp.ok ? 200 : 500).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}