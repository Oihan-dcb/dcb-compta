// Internal helper — log to app_error_log from API routes (server-side, no fetch to self)
// Used by other API routes via: import { logApiError } from './_logError.js'

const SUPABASE_URL = 'https://omuncchvypbtxkpalwcr.supabase.co'

export async function logApiError(source, err, context = {}) {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/app_error_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        source,
        level: 'error',
        message: err?.message || String(err),
        stack: err?.stack ? String(err.stack).slice(0, 5000) : null,
        context: context || null,
        environment: process.env.VERCEL_ENV ?? 'production',
      }),
    })
  } catch {
    // never throw
  }
}
