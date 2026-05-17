import { supabase } from './supabase'
import { AGENCE } from './agence'

/**
 * Enregistre une erreur en base — fire-and-forget, jamais de throw.
 * @param {string} action  — contexte lisible ('ventilation.import', 'window.onerror', …)
 * @param {Error|unknown} err
 * @param {object} [meta] — infos additionnelles, sans secret
 */
export function logError(action, err, meta = {}, level = 'error') {
  try {
    const message = err?.message || String(err) || 'Erreur inconnue'
    const stack = (err?.stack || '').slice(0, 5000) || null
    const route = typeof window !== 'undefined' ? window.location.pathname : null

    supabase.from('app_error_log').insert({
      // colonnes historiques
      app: 'compta',
      route,
      action,
      agence: AGENCE,
      message,
      stack,
      metadata: meta,
      // nouvelles colonnes structurées
      source: 'frontend_compta',
      level,
      context: { action, route, agence: AGENCE, ...meta },
      environment: import.meta.env?.MODE ?? 'production',
    }).then(() => {}).catch(() => {})
  } catch {
    // ne jamais bloquer l'appelant
  }
}

export function logWarn(action, err, meta = {}) {
  return logError(action, err, meta, 'warn')
}

export function logInfo(action, err, meta = {}) {
  return logError(action, err, meta, 'info')
}
