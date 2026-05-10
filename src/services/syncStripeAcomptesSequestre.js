import { supabase } from '../lib/supabase'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_KEY
export const HAS_STRIPE_SEQUESTRE = !!STRIPE_KEY

async function stripeGet(path) {
  const r = await fetch('https://api.stripe.com' + path, {
    headers: { Authorization: 'Bearer ' + STRIPE_KEY },
  })
  if (!r.ok) throw new Error('Stripe ' + r.status + ' — ' + path)
  return r.json()
}

/**
 * Pour chaque résa direct/stripe en statut a_verifier_acompte :
 * cherche dans Stripe les charges capturées <= dateCloture
 * et insère dans reservation_paiement (mouvement_id null, type='acompte').
 *
 * @param {Array} lignes — lignes du séquestre (avec id, code, platform, statut)
 * @param {string} dateCloture — ex: '2025-12-31'
 * @returns {{ found: number, inserted: number, errors: number }}
 */
export async function syncStripeAcomptesSequestre(lignes, dateCloture) {
  const log = { found: 0, inserted: 0, errors: 0 }
  if (!STRIPE_KEY) { log.errors = 1; return log }

  const tsMax = Math.floor(new Date(dateCloture + 'T23:59:59Z').getTime() / 1000)

  const toSearch = lignes.filter(l =>
    (l.platform === 'direct' || l.platform === 'stripe') &&
    l.statut === 'a_verifier_acompte' &&
    l.code?.startsWith('HOST-')
  )
  if (!toSearch.length) return log

  for (const resa of toSearch) {
    try {
      let charges = []

      // 1. Chercher par metadata reservation_code
      try {
        const r1 = await stripeGet(
          `/v1/charges/search?query=${encodeURIComponent(`metadata['reservation_code']:'${resa.code}'`)}&limit=10`
        )
        charges = (r1.data || []).filter(c => c.status === 'succeeded' && c.captured && c.created <= tsMax)
      } catch (_) { /* search API peut être indisponible */ }

      // 2. Fallback : chercher par description (Hospitable inclut le code dans la description)
      if (!charges.length) {
        try {
          const r2 = await stripeGet(
            `/v1/charges/search?query=${encodeURIComponent(`description:'${resa.code}'`)}&limit=10`
          )
          charges = (r2.data || []).filter(c => c.status === 'succeeded' && c.captured && c.created <= tsMax)
        } catch (_) {}
      }

      if (!charges.length) continue
      log.found++

      for (const ch of charges) {
        const datePaiement = new Date(ch.created * 1000).toISOString().slice(0, 10)
        const montant = ch.amount_captured || ch.amount || 0

        // Vérifier qu'on n'a pas déjà cette charge en base
        const { data: exist } = await supabase
          .from('reservation_paiement')
          .select('id')
          .eq('reservation_id', resa.id)
          .eq('note', `stripe_charge:${ch.id}`)
          .maybeSingle()
        if (exist) continue

        const { error } = await supabase.from('reservation_paiement').insert({
          reservation_id: resa.id,
          mouvement_id: null,
          montant,
          date_paiement: datePaiement,
          type_paiement: 'acompte',
          description_paiement: `Stripe acompte séquestre — ${resa.code}`,
          note: `stripe_charge:${ch.id}`,
        })

        if (!error) log.inserted++
        else if (error.code !== '23505') log.errors++
      }
    } catch (e) {
      console.error('syncStripeAcomptesSequestre:', resa.code, e.message)
      log.errors++
    }
  }

  return log
}
