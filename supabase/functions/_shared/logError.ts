// Shared helper — write to app_error_log via service_role
// Usage: await logError({ source: 'edge_allocate-encaissements', message: err.message, stack: err.stack, context: {...} })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface LogErrorParams {
  source: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  user_email?: string
  level?: 'error' | 'warn' | 'info'
  environment?: string
}

export async function logError(params: LogErrorParams): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return
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
        source: params.source,
        level: params.level ?? 'error',
        message: params.message,
        stack: params.stack ?? null,
        context: params.context ?? null,
        user_email: params.user_email ?? null,
        environment: params.environment ?? 'production',
      }),
    })
  } catch {
    // Never throw — logging must not break the main flow
  }
}
