/**
 * stripe-acomptes-sequestre
 *
 * Cherche dans Stripe les acomptes capturés avant dateCloture pour une liste
 * de codes de réservation directes (HOST-XXXX). Insère dans reservation_paiement.
 * La clé Stripe reste côté serveur — ne jamais exposer via VITE_.
 *
 * Body JSON : { codes: string[], dateCloture: string, resaByCode: Record<string, string> }
 *   - codes        : codes réservation à chercher (ex: ['HOST-J323DH'])
 *   - dateCloture  : '2025-12-31'
 *   - resaByCode   : mapping code → reservation_id (UUID)
 *
 * Retourne : { found: number, inserted: number, errors: number }
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function stripeGet(path: string) {
  const r = await fetch('https://api.stripe.com' + path, {
    headers: { Authorization: 'Bearer ' + STRIPE_SECRET },
  })
  if (!r.ok) throw new Error('Stripe ' + r.status + ' — ' + path)
  return r.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  if (!STRIPE_SECRET) {
    return Response.json({ ok: false, error: 'STRIPE_SECRET_KEY non configuré' }, { status: 500 })
  }

  let codes: string[], dateCloture: string, resaByCode: Record<string, string>
  try {
    ({ codes, dateCloture, resaByCode } = await req.json())
  } catch {
    return Response.json({ ok: false, error: 'Body JSON invalide' }, { status: 400 })
  }

  if (!codes?.length || !dateCloture || !resaByCode) {
    return Response.json({ ok: false, error: 'Paramètres manquants' }, { status: 400 })
  }

  const tsMax = Math.floor(new Date(dateCloture + 'T23:59:59Z').getTime() / 1000)
  const log = { found: 0, inserted: 0, errors: 0 }

  for (const code of codes) {
    const reservationId = resaByCode[code]
    if (!reservationId) continue

    try {
      let charges: any[] = []

      // 1. Chercher par metadata reservation_code (Hospitable peuple ce champ)
      try {
        const r1 = await stripeGet(
          `/v1/charges/search?query=${encodeURIComponent(`metadata['reservation_code']:'${code}'`)}&limit=10`
        )
        charges = (r1.data ?? []).filter((c: any) =>
          c.status === 'succeeded' && c.captured && c.created <= tsMax
        )
      } catch (_) { /* search API peut ne pas être disponible */ }

      // 2. Fallback : chercher par description (Hospitable inclut le code)
      if (!charges.length) {
        try {
          const r2 = await stripeGet(
            `/v1/charges/search?query=${encodeURIComponent(`description:'${code}'`)}&limit=10`
          )
          charges = (r2.data ?? []).filter((c: any) =>
            c.status === 'succeeded' && c.captured && c.created <= tsMax
          )
        } catch (_) {}
      }

      if (!charges.length) continue
      log.found++

      for (const ch of charges) {
        const datePaiement = new Date(ch.created * 1000).toISOString().slice(0, 10)
        const montant = ch.amount_captured || ch.amount || 0
        const noteId = `stripe_charge:${ch.id}`

        // Vérifier doublon
        const { data: exist } = await supabase
          .from('reservation_paiement')
          .select('id')
          .eq('reservation_id', reservationId)
          .eq('note', noteId)
          .maybeSingle()
        if (exist) continue

        const { error } = await supabase.from('reservation_paiement').insert({
          reservation_id: reservationId,
          mouvement_id: null,
          montant,
          date_paiement: datePaiement,
          type_paiement: 'acompte',
          description_paiement: `Stripe acompte séquestre — ${code}`,
          note: noteId,
        })

        if (!error) log.inserted++
        else if (error.code !== '23505') log.errors++
      }
    } catch (e: any) {
      console.error('stripe-acomptes-sequestre:', code, e?.message)
      log.errors++
    }
  }

  return Response.json({ ok: true, ...log })
})
