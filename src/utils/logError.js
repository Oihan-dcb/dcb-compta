// Frontend logger — sends errors to /api/log-error
// Never throws — logging must not break the app

const API_URL = '/api/log-error'
const SOURCE  = 'frontend_compta'

let _userEmail = null

export function setLogErrorUser(email) {
  _userEmail = email
}

export async function logError(message, { stack, context, level = 'error' } = {}) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: SOURCE,
        level,
        message: String(message).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 5000) : undefined,
        context: context ?? undefined,
        user_email: _userEmail ?? undefined,
        environment: import.meta.env.MODE ?? 'production',
      }),
    })
  } catch {
    // intentionally silent
  }
}

export function logWarn(message, opts = {}) {
  return logError(message, { ...opts, level: 'warn' })
}

export function logInfo(message, opts = {}) {
  return logError(message, { ...opts, level: 'info' })
}
