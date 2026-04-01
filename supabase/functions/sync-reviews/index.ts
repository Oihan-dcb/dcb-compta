import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SERVICE_ROLE_KEY')!
const HOSP_TOKEN   = Deno.env.get('HOSPITABLE_TOKEN')!
const BASE_URL     = 'https://public.api.hospitable.com/v2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function apiFetch(path: string, params: Record<string, any> = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(`${k}[]`, x))
    else if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  })
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${HOSP_TOKEN}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Hospitable ${res.status}: ${err.message || path}`)
  }
  return res.json()
}

async function fetchAll(path: string, params: Record<string, any> = {}) {
  let page = 1, all: any[] = []
  while (true) {
    const data = await apiFetch(path, { ...params, limit: 50, page })
    const items: any[] = data.data || []
    all = all.concat(items)
    const meta = data.meta || {}
    if (page >= (meta.last_page || 1) || items.length < 50) break
    page++
    await new Promise(r => setTimeout(r, 100))
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const body = await req.json().catch(() => ({}))
  const mois: string | undefined = body.mois  // optionnel, format YYYY-MM

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Récupérer tous nos biens avec leur hospitable_id (UUID propriété)
  const { data: biens } = await sb
    .from('bien')
    .select('id, hospitable_id, hospitable_name')
    .not('hospitable_id', 'is', null)

  if (!biens?.length) return json({ ok: true, total: 0, synced: 0 })

  let total = 0, synced = 0, errors = 0

  for (const bien of biens) {
    let reviews: any[]
    try {
      reviews = await fetchAll(`/properties/${bien.hospitable_id}/reviews`)
    } catch (e: any) {
      console.error(`Skipping ${bien.hospitable_name}: ${e.message}`)
      errors++
      continue
    }

    for (const review of reviews) {

      // Filtrer par mois si fourni
      if (mois) {
        const ts = review.reviewed_at || ''
        if (!ts.startsWith(mois)) continue
      }

      total++

      const row = {
        reservation_id:            null,
        bien_id:                   bien.id,
        hospitable_reservation_id: review.id,
        reviewer_name:             null,
        rating:                    review.public?.rating ?? null,
        comment:                   review.public?.review ?? null,
        submitted_at:              review.reviewed_at ?? null,
      }

      const { error } = await sb
        .from('reservation_review')
        .upsert(row, { onConflict: 'hospitable_reservation_id' })

      if (error) { console.error('upsert:', error.message); errors++ }
      else synced++
    }

    await new Promise(r => setTimeout(r, 100))  // pause entre propriétés
  }

  console.log(`sync-reviews: ${synced} ok, ${errors} errors / ${total} reviews, ${biens.length} properties`)
  return json({ ok: true, total, synced, errors, properties: biens.length })
})
