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

  // Récupérer les hospitable_id de tous nos biens actifs
  const { data: biens } = await sb
    .from('bien')
    .select('hospitable_id')
    .not('hospitable_id', 'is', null)

  const propertyIds = (biens || []).map((b: any) => b.hospitable_id).filter(Boolean)
  if (!propertyIds.length) return json({ ok: true, total: 0, synced: 0 })

  // Paramètres de la requête /reservations
  const params: Record<string, any> = {
    properties: propertyIds,
    include: 'reviews',
  }
  if (mois) {
    const [y, m] = mois.split('-').map(Number)
    params.start_date = `${mois}-01`
    params.end_date   = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`
  }

  let reservations: any[]
  try {
    reservations = await fetchAll('/reservations', params)
  } catch (e: any) {
    console.error('Hospitable /reservations error:', e.message)
    return json({ error: e.message }, 500)
  }

  // Filtrer les réservations qui ont des reviews
  const resasWithReviews = reservations.filter((r: any) => r.reviews?.length)
  if (!resasWithReviews.length) return json({ ok: true, total: 0, synced: 0 })

  // Résoudre hospitable_id → reservation.id interne
  const hospIds = resasWithReviews.map((r: any) => r.id)
  const { data: resas } = await sb
    .from('reservation')
    .select('id, hospitable_id')
    .in('hospitable_id', hospIds)

  const resaMap = new Map((resas || []).map((r: any) => [r.hospitable_id, r.id]))

  let total = 0, synced = 0, errors = 0

  for (const resa of resasWithReviews) {
    for (const review of (resa.reviews || [])) {
      total++
      const row = {
        reservation_id:            resaMap.get(resa.id) ?? null,
        hospitable_reservation_id: resa.id,
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
    }
  }

  console.log(`sync-reviews: ${synced} ok, ${errors} errors, total ${total} reviews in ${resasWithReviews.length} resas`)
  return json({ ok: true, total, synced, errors })
})
