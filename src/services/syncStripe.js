/**
 * syncStripe.js — Synchronisation automatique des virements Stripe
 *
 * Pour chaque nouveau payout Stripe :
 * 1. Matcher au mouvement bancaire par montant exact
 * 2. Récupérer les transactions (codes HOST-XXXXX + Payment Links)
 * 3. Insérer dans stripe_payout_line
 * 4. Mettre à jour le detail du mouvement avec les frais
 */
import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

const STRIPE_KEY = import.meta.env.VITE_STRIPE_KEY
export const HAS_STRIPE = !!STRIPE_KEY

async function stripeGet(path) {
  const r = await fetch('https://api.stripe.com' + path, {
    headers: { Authorization: 'Bearer ' + STRIPE_KEY }
  })
  if (!r.ok) throw new Error('Stripe API error: ' + r.status + ' ' + path)
  return r.json()
}

/**
 * Sync complet Stripe — appele depuis PageRapprochement au clic Sync
 * Retourne { matched, inserted, updated, errors }
 */
export async function syncStripe() {
  const log = { matched: 0, inserted: 0, updated: 0, errors: 0 }
  if (!STRIPE_KEY) { log.errors = 1; return log }

  try {
    // 1. Charger tous les payouts Stripe depuis l'API
    let allPayouts = []
    let url = '/v1/payouts?limit=100&status=paid'
    while (url) {
      const r = await stripeGet(url)
      allPayouts.push(...r.data)
      url = r.has_more
        ? `/v1/payouts?limit=100&status=paid&starting_after=${r.data[r.data.length - 1].id}`
        : null
    }

    // 2. Charger les mouvements Stripe en attente pour cette agence
    const { data: mouvs } = await supabase
      .from('mouvement_bancaire')
      .select('id, credit, statut_matching')
      .eq('canal', 'stripe')
      .eq('agence', AGENCE)
      .gte('credit', 100)

    // 3. Charger les payout_ids déjà traités (mouvement effectivement rapproché)
    const { data: existingLines } = await supabase
      .from('stripe_payout_line')
      .select('stripe_payout_id, mouvement_bancaire(statut_matching)')
    const alreadyDone = new Set(
      (existingLines || [])
        .filter(l => l.mouvement_bancaire?.statut_matching === 'rapproche')
        .map(l => l.stripe_payout_id)
    )

    // 4. Matcher payouts aux mouvements
    const used = new Set()
    const matches = []
    for (const po of allPayouts) {
      if (alreadyDone.has(po.id)) continue // deja traite
      const mouv = mouvs?.find(m => !used.has(m.id) && Math.abs(m.credit - po.amount) <= 2)
      if (mouv) {
        matches.push({ payout_id: po.id, mouvement_id: mouv.id, amount: po.amount })
        used.add(mouv.id)
      }
    }
    log.matched = matches.length
    if (!matches.length) return log

    // 5. Pour chaque payout, recuperer les transactions et inserer les lignes
    for (const po of matches) {
      try {
        const txns = await stripeGet(`/v1/balance/history?payout=${po.payout_id}&limit=100`)
        const payTxns = txns.data.filter(t => t.type === 'payment' || t.type === 'charge')
        if (!payTxns.length) continue

        const charges = await Promise.all(
          payTxns.map(t => stripeGet(`/v1/charges/${t.source}`))
        )

        const lines = payTxns.map((tx, i) => {
          const ch = charges[i]
          let code = ch.metadata?.reservation_code || null
          let terme = null
          if (!code && tx.description) {
            const m = tx.description.match(/HOST-([A-Z0-9]+)/)
            if (m) code = 'HOST-' + m[1]
            const tm = tx.description.match(/Term (\d)\/(\d)/)
            if (tm) terme = tm[1] + '/' + tm[2]
          }
          return {
            stripe_payout_id: po.payout_id,
            mouvement_id: po.mouvement_id,
            stripe_charge_id: ch.id || null,
            reservation_code: code,
            type_ligne: !code ? 'extra' : (terme ? 'paiement_partiel' : 'reservation'),
            terme: terme || null,
            montant_brut: tx.amount,
            montant_net: tx.net,
            description: tx.description || null,
            guest_name: ch.billing_details?.name || null,
            created_at: new Date(tx.created * 1000).toISOString().slice(0, 10)
          }
        })

        // Inserer les lignes (ignorer doublons)
        const { error: insertErr } = await supabase
          .from('stripe_payout_line')
          .upsert(lines, { onConflict: 'stripe_charge_id', ignoreDuplicates: true })
        if (!insertErr) log.inserted += lines.length

        // Calcul des frais et update du mouvement
        const totalBrut = lines.reduce((s, l) => s + l.montant_brut, 0)
        const totalNet = lines.reduce((s, l) => s + l.montant_net, 0)
        const frais = ((totalBrut - totalNet) / 100).toFixed(2)
        const extras = lines.filter(l => l.type_ligne === 'extra').length
        const detail = `Stripe | ${lines.length} paiements${extras > 0 ? ` + ${extras} extra` : ''} | frais: ${frais}\u20AC`

        await supabase
          .from('mouvement_bancaire')
          .update({ statut_matching: 'rapproche', detail })
          .eq('id', po.mouvement_id)
        log.updated++

        // Marquer les réservations comme rapprochées + insérer reservation_paiement
        const codes = [...new Set(lines.map(l => l.reservation_code).filter(Boolean))]
        if (codes.length) {
          const { data: resas } = await supabase
            .from('reservation')
            .select('id, code')
            .in('code', codes)
          for (const resa of (resas || [])) {
            await supabase.from('reservation').update({ rapprochee: true }).eq('id', resa.id)
            const { data: existRp } = await supabase.from('reservation_paiement')
              .select('id').eq('reservation_id', resa.id).eq('mouvement_id', po.mouvement_id).maybeSingle()
            if (!existRp) {
              const line = lines.find(l => l.reservation_code === resa.code)
              await supabase.from('reservation_paiement').insert({
                reservation_id: resa.id,
                mouvement_id: po.mouvement_id,
                montant: line?.montant_net ?? null,
                date_paiement: line?.created_at ?? null,
                type_paiement: line?.terme ? 'partiel' : 'total',
              }).catch(() => {})
            }
          }
        }

      } catch (e) {
        console.error('syncStripe payout error:', po.payout_id, e)
        log.errors++
      }
    }

  } catch (e) {
    console.error('syncStripe error:', e)
    log.errors++
  }

  return log
}
