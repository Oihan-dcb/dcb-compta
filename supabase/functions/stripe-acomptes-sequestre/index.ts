/**
 * stripe-acomptes-sequestre
 *
 * Pour chaque code de réservation directe (HOST-XXXX) :
 * 1. Cherche dans stripe_payout_line les charges capturées avant dateCloture
 * 2. Fallback : Stripe Search API (metadata ou description)
 * Insère dans reservation_paiement (mouvement_id null) si pas déjà présent.
 *
 * Body JSON : { codes: string[], dateCloture: string, resaByCode: Record<string, string> }
 * Retourne  : { found: number, inserted: number, errors: number }
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function stripeGet(path: string) {
  const r = await fetch('https://api.stripe.com' + path, {
    headers: { Authorization: 'Bearer ' + STRIPE_SECRET },
  })
  if (!r.ok) throw new Error('Stripe ' + r.status)
  return r.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  let codes: string[], dateCloture: string, resaByCode: Record<string, string>
  try {
    ({ codes, dateCloture, resaByCode } = await req.json())
  } catch {
    return Response.json({ ok: false, error: 'Body JSON invalide' }, { status: 400, headers: CORS })
  }
  if (!codes?.length || !dateCloture || !resaByCode) {
    return Response.json({ ok: false, error: 'Paramètres manquants' }, { status: 400, headers: CORS })
  }

  const log = { found: 0, inserted: 0, errors: 0 }

  // ── Étape 1 : stripe_payout_line déjà en DB ───────────────────────────────
  // Les charges déjà syncées ont created_at = date de capture réelle.
  // C'est la source de vérité la plus fiable — pas besoin d'appeler Stripe.
  const { data: splRows } = await supabase
    .from('stripe_payout_line')
    .select('reservation_code, stripe_charge_id, created_at, montant_net')
    .in('reservation_code', codes)
    .lte('created_at', dateCloture)

  type SplCandidate = { code: string; chargeId: string; date: string; montant: number }
  const candidatesFromDB: SplCandidate[] = (splRows ?? []).map((r: any) => ({
    code: r.reservation_code,
    chargeId: r.stripe_charge_id,
    date: r.created_at,
    montant: r.montant_net,
  }))

  // ── Étape 2 : fallback Stripe Search pour codes sans résultat en DB ────────
  const codesInDB = new Set(candidatesFromDB.map(c => c.code))
  const codesManquants = codes.filter(c => !codesInDB.has(c))
  const candidatesFromStripe: SplCandidate[] = []

  if (codesManquants.length && STRIPE_SECRET) {
    const tsMax = Math.floor(new Date(dateCloture + 'T23:59:59Z').getTime() / 1000)
    for (const code of codesManquants) {
      try {
        let found = false

        // Tentative 1 : PaymentIntents search par metadata (les metadata sont sur le PI)
        try {
          const r1 = await stripeGet(
            `/v1/payment_intents/search?query=${encodeURIComponent(`metadata['reservation_code']:'${code}'`)}&limit=10`
          )
          const pis = (r1.data ?? []).filter((pi: any) =>
            (pi.status === 'succeeded' || pi.status === 'requires_capture') && pi.created <= tsMax
          )
          console.log(`[${code}] PI search: ${r1.data?.length ?? 0} résultats, ${pis.length} après filtre`)
          for (const pi of pis) {
            candidatesFromStripe.push({
              code,
              chargeId: pi.latest_charge || pi.id,
              date: new Date(pi.created * 1000).toISOString().slice(0, 10),
              montant: pi.amount_received || pi.amount || 0,
            })
            found = true
          }
        } catch (e1: any) {
          console.error(`[${code}] PI metadata search error:`, e1?.message)
        }

        // Tentative 2 : Charges search par metadata
        if (!found) {
          try {
            const r2 = await stripeGet(
              `/v1/charges/search?query=${encodeURIComponent(`metadata['reservation_code']:'${code}'`)}&limit=10`
            )
            const charges = (r2.data ?? []).filter((c: any) => (c.status === 'succeeded' || c.status === 'pending') && c.created <= tsMax)
            for (const ch of charges) {
              candidatesFromStripe.push({
                code,
                chargeId: ch.id,
                date: new Date(ch.created * 1000).toISOString().slice(0, 10),
                montant: ch.amount_captured || ch.amount || 0,
              })
              found = true
            }
          } catch (e2: any) {
            console.error(`[${code}] Charge metadata search error:`, e2?.message)
          }
        }

        // Tentative 3 : Charges search par description
        if (!found) {
          try {
            const r3 = await stripeGet(
              `/v1/charges/search?query=${encodeURIComponent(`description:'${code}'`)}&limit=10`
            )
            const charges = (r3.data ?? []).filter((c: any) => (c.status === 'succeeded' || c.status === 'pending') && c.created <= tsMax)
            for (const ch of charges) {
              candidatesFromStripe.push({
                code,
                chargeId: ch.id,
                date: new Date(ch.created * 1000).toISOString().slice(0, 10),
                montant: ch.amount_captured || ch.amount || 0,
              })
            }
          } catch (e3: any) {
            console.error(`[${code}] Charge description search error:`, e3?.message)
          }
        }
      } catch (e: any) {
        console.error(`[${code}] Stripe search fatal:`, e?.message)
        log.errors++
      }
    }
  }

  const allCandidates = [...candidatesFromDB, ...candidatesFromStripe]

  // ── Étape 3 : insérer reservation_paiement pour les acomptes prouvés ───────
  for (const c of allCandidates) {
    const reservationId = resaByCode[c.code]
    if (!reservationId) continue

    const noteId = `stripe_charge:${c.chargeId}`
    try {
      // Doublon par note (charge_id)
      const { data: exist } = await supabase
        .from('reservation_paiement')
        .select('id')
        .eq('reservation_id', reservationId)
        .eq('note', noteId)
        .maybeSingle()
      if (exist) continue

      log.found++
      const { error } = await supabase.from('reservation_paiement').insert({
        reservation_id: reservationId,
        mouvement_id: null,
        montant: c.montant,
        date_paiement: c.date,
        type_paiement: 'acompte',
        description_paiement: `Stripe acompte séquestre — ${c.code}`,
        note: noteId,
      })

      if (!error) log.inserted++
      else if (error.code !== '23505') log.errors++
    } catch (e: any) {
      console.error('insert reservation_paiement:', c.code, e?.message)
      log.errors++
    }
  }

  return Response.json({ ok: true, ...log }, { headers: CORS })
})
