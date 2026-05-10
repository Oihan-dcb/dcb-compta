import { supabase } from '../lib/supabase'

// Pas de clé Stripe côté frontend — tout passe par l'Edge Function
export const HAS_STRIPE_SEQUESTRE = true // la fonction est toujours disponible

/**
 * Pour chaque résa direct/stripe en statut a_verifier_acompte :
 * délègue à l'Edge Function stripe-acomptes-sequestre qui appelle Stripe
 * côté serveur et insère dans reservation_paiement.
 *
 * @param {Array} lignes   — lignes du séquestre (avec id, code, platform, statut)
 * @param {string} dateCloture — ex: '2025-12-31'
 * @returns {{ found: number, inserted: number, errors: number }}
 */
export async function syncStripeAcomptesSequestre(lignes, dateCloture) {
  const toSearch = lignes.filter(l =>
    (l.platform === 'direct' || l.platform === 'stripe') &&
    l.statut === 'a_verifier_acompte' &&
    l.code?.startsWith('HOST-')
  )
  if (!toSearch.length) return { found: 0, inserted: 0, errors: 0 }

  const codes = toSearch.map(l => l.code)
  const resaByCode = Object.fromEntries(toSearch.map(l => [l.code, l.id]))

  const { data, error } = await supabase.functions.invoke('stripe-acomptes-sequestre', {
    body: { codes, dateCloture, resaByCode },
  })

  if (error) throw new Error(error.message)
  if (!data?.ok) throw new Error(data?.error || 'Erreur Edge Function')

  return { found: data.found ?? 0, inserted: data.inserted ?? 0, errors: data.errors ?? 0 }
}
