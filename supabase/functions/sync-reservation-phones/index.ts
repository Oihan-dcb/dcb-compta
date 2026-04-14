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
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Récupérer les réservations sans guest_phone
  const { data: resas, error: resaErr } = await sb
    .from('reservation')
    .select('id, hospitable_id, guest_name')
    .is('guest_phone', null)
    .not('hospitable_id', 'is', null)
    .limit(500)

  if (resaErr) return json({ error: resaErr.message }, 500)
  if (!resas?.length) return json({ ok: true, updated: 0, message: 'Toutes les réservations ont déjà un téléphone' })

  let updated = 0, notFound = 0, errors = 0

  for (const resa of resas) {
    try {
      const data = await apiFetch(`/reservations/${resa.hospitable_id}`)
      const reservation = data.data || data

      const phone   = reservation.guest?.phone || reservation.guest?.phone_number || null
      const country = reservation.guest?.country || reservation.guest?.nationality || null

      if (phone) {
        const { error } = await sb
          .from('reservation')
          .update({ guest_phone: phone, guest_country: country })
          .eq('id', resa.id)

        if (error) { errors++; continue }
        updated++
      } else {
        notFound++
      }
    } catch (e: any) {
      console.error(`Error for ${resa.hospitable_id}:`, e.message)
      errors++
    }

    await new Promise(r => setTimeout(r, 80))  // rate limiting
  }

  console.log(`sync-reservation-phones: ${updated} updated, ${notFound} no phone, ${errors} errors / ${resas.length} reservations`)
  return json({ ok: true, updated, notFound, errors, total: resas.length })
})
