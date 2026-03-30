import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SERVICE_ROLE_KEY')!
const HOSP_TOKEN    = Deno.env.get('HOSPITABLE_TOKEN')!
const BASE_URL      = 'https://public.api.hospitable.com/v2'

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

async function fetchAllReviews(params: Record<string, any> = {}) {
  let page = 1, all: any[] = []
  while (true) {
    const data = await apiFetch('/reviews', { ...params, limit: 50, page })
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
  const mois: string | undefined = body.mois   // optionnel, format YYYY-MM

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Plage de dates si mois fourni
  const params: Record<string, any> = {}
  if (mois) {
    const [y, m] = mois.split('-').map(Number)
    params.from = `${mois}-01`
    params.to   = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`
  }

  let reviews: any[]
  try {
    reviews = await fetchAllReviews(params)
  } catch (e: any) {
    console.error('Hospitable /reviews error:', e.message)
    return json({ error: e.message }, 500)
  }

  if (!reviews.length) return json({ ok: true, total: 0, synced: 0 })

  // Résoudre hospitable_id → reservation.id interne
  const hospIds = [...new Set(reviews.map((r: any) => r.reservation_id).filter(Boolean))]
  const { data: resas } = await sb
    .from('reservation')
    .select('id, hospitable_id')
    .in('hospitable_id', hospIds)

  const resaMap = new Map((resas || []).map((r: any) => [r.hospitable_id, r.id]))

  let synced = 0, errors = 0
  for (const review of reviews) {
    const hospResaId = review.reservation_id
    const row = {
      reservation_id:            resaMap.get(hospResaId) ?? null,
      hospitable_reservation_id: hospResaId,
      reviewer_name:             review.reviewer_name ?? review.guest?.name ?? null,
      rating:                    review.rating ?? review.overall_rating ?? null,
      comment:                   review.comment ?? review.body ?? null,
      submitted_at:              review.submitted_at ?? review.created_at ?? null,
    }
    const { error } = await sb
      .from('reservation_review')
      .upsert(row, { onConflict: 'hospitable_reservation_id' })
    if (error) { console.error('upsert error:', error.message); errors++ }
    else synced++
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`sync-reviews: ${synced} ok, ${errors} errors, total ${reviews.length}`)
  return json({ ok: true, total: reviews.length, synced, errors })
})
