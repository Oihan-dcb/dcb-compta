/**
 * syncStripe.js — Synchronisation automatique des virements Stripe
 * La logique tourne côté serveur (api/sync-stripe.js), STRIPE_KEY jamais exposé.
 */
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// Toujours disponible — la clé est serveur, pas de détection build-time
export const HAS_STRIPE = true

export async function syncStripe() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { matched: 0, inserted: 0, updated: 0, errors: 1, errorDetails: [{ message: 'Session expirée' }] }

  const res = await fetch('/api/sync-stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token,
    },
    body: JSON.stringify({ agence: AGENCE }),
  })

  const log = await res.json()
  if (!res.ok) throw new Error(log?.error || `Erreur serveur ${res.status}`)
  return log
}
