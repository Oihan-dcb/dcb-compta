// POST { source, message, stack?, context?, user_email?, level?, environment? }
// Public endpoint (no auth) — called by frontends that may not have a session
// Uses service_role to insert into app_error_log

const SUPABASE_URL  = 'https://omuncchvypbtxkpalwcr.supabase.co'
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { source, message, stack, context, user_email, level, environment } = req.body || {}
  if (!source || !message) return res.status(400).json({ error: 'source and message are required' })

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_error_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        source,
        level: level ?? 'error',
        message: String(message).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 5000) : null,
        context: context ?? null,
        user_email: user_email ?? null,
        environment: environment ?? process.env.VERCEL_ENV ?? 'production',
      }),
    })
    if (!r.ok) throw new Error(`Supabase ${r.status}`)
    return res.status(200).json({ ok: true })
  } catch (err) {
    // Silently fail — logging must never break the caller
    console.error('[log-error] failed to write:', err.message)
    return res.status(200).json({ ok: false })
  }
}
