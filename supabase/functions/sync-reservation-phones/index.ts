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
    await new Promise(r => setTimeout(r, 150))
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Récupérer tous les biens avec hospitable_id
  const { data: biens } = await sb
    .from('bien')
    .select('id, hospitable_id, hospitable_name')
    .not('hospitable_id', 'is', null)

  if (!biens?.length) return json({ ok: true, updated: 0, message: 'Aucun bien avec hospitable_id' })

  const propertyIds = biens.map((b: any) => b.hospitable_id)

  // Récupérer les réservations depuis Hospitable en bulk (avec guests)
  let hospResas: any[]
  try {
    hospResas = await fetchAll('/reservations', {
      properties: propertyIds,
      include: 'guests',
    })
  } catch (e: any) {
    console.error('Hospitable fetch error:', e.message)
    return json({ ok: false, error: e.message }, 500)
  }

  if (!hospResas.length) return json({ ok: true, updated: 0, message: 'Aucune réservation retournée par Hospitable' })

  // Construire un map hospitable_id → phone/country
  const phoneMap: Record<string, { phone: string | null, country: string | null }> = {}
  for (const r of hospResas) {
    const hospId = r.id || r.uuid
    if (!hospId) continue
    const phone   = r.guest?.phone || r.guest?.phone_number || r.guests?.[0]?.phone || null
    const country = r.guest?.country || r.guest?.nationality || r.guests?.[0]?.country_code || null
    if (phone || country) phoneMap[hospId] = { phone, country }
  }

  const withPhone = Object.values(phoneMap).filter(v => v.phone).length
  console.log(`Hospitable returned ${hospResas.length} reservations, ${withPhone} with phone`)

  if (!withPhone) {
    return json({
      ok: true,
      updated: 0,
      hospitable_total: hospResas.length,
      message: "Hospitable n'expose pas les téléphones via l'API publique"
    })
  }

  // Mettre à jour les réservations dans notre DB
  let updated = 0, errors = 0
  const hospIds = Object.keys(phoneMap)

  // Traiter par lots de 100 pour éviter le timeout
  for (let i = 0; i < hospIds.length; i += 100) {
    const batch = hospIds.slice(i, i + 100)
    for (const hospId of batch) {
      const { phone, country } = phoneMap[hospId]
      if (!phone) continue
      const { error } = await sb
        .from('reservation')
        .update({ guest_phone: phone, ...(country ? { guest_country: country } : {}) })
        .eq('hospitable_id', hospId)
        .is('guest_phone', null)  // ne pas écraser les données existantes
      if (error) errors++
      else updated++
    }
  }

  console.log(`sync-reservation-phones: ${updated} updated, ${errors} errors`)
  return json({ ok: true, updated, errors, hospitable_total: hospResas.length })
})
