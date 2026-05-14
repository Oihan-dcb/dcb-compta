import { supabase } from './supabase'
import { AGENCE } from './agence'

/**
 * Enregistre une erreur en base — fire-and-forget, jamais de throw.
 * @param {string} action  — contexte lisible ('ventilation.import', 'window.onerror', …)
 * @param {Error|unknown} err
 * @param {object} [meta] — infos additionnelles, sans secret
 */
export function logError(action, err, meta = {}) {
  try {
    const message = err?.message || String(err) || 'Erreur inconnue'
    const stack = (err?.stack || '').slice(0, 500) || null

    supabase.from('app_error_log').insert({
      app: 'compta',
      route: typeof window !== 'undefined' ? window.location.pathname : null,
      action,
      agence: AGENCE,
      message,
      stack,
      metadata: meta,
    }).then(() => {}).catch(() => {})
  } catch {
    // ne jamais bloquer l'appelant
  }
}
