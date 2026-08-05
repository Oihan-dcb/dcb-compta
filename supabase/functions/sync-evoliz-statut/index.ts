/**
 * sync-evoliz-statut — Edge Function Supabase (cron quotidien)
 *
 * facture_evoliz.statut ne se met jamais à jour tout seul après l'envoi
 * (bug constaté 2026-08-05 : 117 factures réellement payées sur 146 selon
 * Evoliz, seulement 2 marquées 'payee' en base). Cette synchro interroge
 * Evoliz (statut réel, source de vérité) et met à jour statut='payee' dès
 * qu'une facture 'envoye_evoliz' est effectivement réglée côté Evoliz.
 *
 * Prérequis à la relance automatique (relance-facture-impayee) : sans cette
 * synchro, une relance basée sur le statut local relancerait indéfiniment
 * des propriétaires ayant déjà payé.
 *
 * Body optionnel : { agence: 'dcb' | 'lauian' } — sinon les deux agences.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const EVOLIZ_COMPANY_ID: Record<string, string> = { dcb: '114158', lauian: '115576' }

async function evolizListInvoices(companyId: string, dateFrom: string, dateTo: string) {
  let page = 1
  const all: any[] = []
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/evoliz-proxy`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'listInvoices', companyId,
        payload: { period: 'custom', dateFrom, dateTo, per_page: 100, page },
      }),
    })
    const json = await res.json()
    if (!res.ok || json?.error) throw new Error(`Evoliz listInvoices: ${JSON.stringify(json)}`)
    const items = json?.data?.data || []
    all.push(...items)
    const lastPage = json?.data?.meta?.last_page || 1
    if (page >= lastPage) break
    page++
  }
  return all
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  let body: { agence?: string } = {}
  try { body = await req.json() } catch { /* cron sans body */ }
  const agences = body.agence ? [body.agence] : ['dcb', 'lauian']

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const results: Record<string, unknown> = {}

  // Fenêtre large (6 mois) : couvre tout ce qui peut encore être 'envoye_evoliz'
  const now = new Date()
  const dateTo = now.toISOString().slice(0, 10)
  const dateFromD = new Date(now); dateFromD.setMonth(dateFromD.getMonth() - 6)
  const dateFrom = dateFromD.toISOString().slice(0, 10)

  for (const agence of agences) {
    const companyId = EVOLIZ_COMPANY_ID[agence]
    if (!companyId) { results[agence] = { error: 'agence inconnue' }; continue }

    try {
      const { data: factures, error } = await supabase
        .from('facture_evoliz')
        .select('id, id_evoliz, mois, total_ttc')
        .eq('agence', agence)
        .eq('statut', 'envoye_evoliz')
        .not('id_evoliz', 'is', null)
      if (error) throw error
      if (!factures?.length) { results[agence] = { checked: 0, updated: 0 }; continue }

      const invoices = await evolizListInvoices(companyId, dateFrom, dateTo)
      const statutById = new Map(invoices.map((inv: any) => [String(inv.invoiceid), inv]))

      let updated = 0
      const updatedIds: string[] = []
      for (const f of factures) {
        const inv = statutById.get(String(f.id_evoliz))
        if (!inv) continue // pas trouvé dans la fenêtre (facture plus ancienne que 6 mois) — ignoré
        if (inv.status === 'paid' && (inv.total?.net_to_pay ?? 0) <= 0) {
          await supabase.from('facture_evoliz').update({ statut: 'payee' }).eq('id', f.id).eq('statut', 'envoye_evoliz')
          updated++
          updatedIds.push(f.id)
        }
      }
      results[agence] = { checked: factures.length, updated, updatedIds }
    } catch (e: any) {
      results[agence] = { error: e.message }
    }
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
