import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let payload: any
  try { payload = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  const event = payload?.event
  const data = payload?.data
  console.log('Webhook received:', event, JSON.stringify(data)?.substring(0, 200))

  if (!event || !data) return new Response('OK', { status: 200 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    if (event.startsWith('reservation.')) await handleReservation(supabase, event, data)
    else if (event.startsWith('property.')) await handleProperty(supabase, event, data)
  } catch (err) {
    console.error('Webhook error:', err)
  }

  return new Response('OK', { status: 200 })
})

async function handleReservation(supabase: any, event: string, data: any) {
  const hospId = data.id || data.uuid
  if (!hospId) return

  if (event === 'reservation.cancelled') {
    await supabase.from('reservation').update({ final_status: 'cancelled' }).eq('hospitable_id', hospId)
    console.log('Cancelled:', hospId)
    return
  }

  if (!['reservation.created', 'reservation.modified', 'reservation.updated'].includes(event)) return

  const propertyId = data.property_id
  if (!propertyId) return

  const { data: bien } = await supabase
    .from('bien')
    .select('id, proprietaire_id, provision_ae_ref, has_ae, taux_commission_override, proprietaire(id, taux_commission)')
    .eq('hospitable_id', propertyId)
    .single()

  if (!bien) { console.log('Bien not found:', propertyId); return }

  const fin = data.financials?.host || {}
  const fees = [
    ...(fin.guest_fees || []).map((f: any) => ({ ...f, fee_type: 'guest_fee' })),
    ...(fin.host_fees || []).map((f: any) => ({ ...f, fee_type: 'host_fee' })),
    ...(fin.taxes || []).map((f: any) => ({ ...f, fee_type: 'tax' })),
    ...(fin.adjustments || []).map((f: any) => ({ ...f, fee_type: 'adjustment' })),
  ]

  const arrival = data.arrival_date?.substring(0, 10)
  const moisComptable = arrival?.substring(0, 7) || null
  const finalStatus = data.reservation_status?.current?.category || data.status || 'accepted'
  // Le nom peut être dans différents champs selon l'événement webhook
  const guestName =
    data.guest?.name ||                          // champ 'guest' singulier
    data.guest_name ||                           // champ direct
    (Array.isArray(data.guests) ? data.guests?.[0]?.name : null) || // ancien format tableau
    null

  const resaRow = {
    hospitable_id: hospId,
    bien_id: bien.id,
    code: data.code,
    platform: data.platform,
    platform_id: data.platform_id,
    arrival_date: arrival,
    departure_date: data.departure_date?.substring(0, 10),
    nights: data.nights,
    guest_name: guestName,
    guest_count: data.guests?.reduce((s: number, g: any) => s + (g.count || 1), 0) || null,
    stay_type: data.stay_type || 'guest',
    owner_stay: data.owner_stay || false,
    reservation_status: data.reservation_status,
    final_status: finalStatus,
    fin_accommodation: fin.accommodation?.amount ?? null,
    fin_revenue: fin.revenue?.amount ?? null,
    fin_host_service_fee: (fin.host_fees || []).reduce((s: number, f: any) => s + f.amount, 0) || null,
    fin_taxes_total: (fin.taxes || []).reduce((s: number, t: any) => s + t.amount, 0) || null,
    fin_currency: fin.currency || 'EUR',
    mois_comptable: moisComptable,
    hospitable_raw: data,
  }

  // Ne pas écraser guest_name si le webhook n'en a pas
  const upsertRow = resaRow.guest_name ? resaRow : { ...resaRow, guest_name: undefined }
  const { data: upserted, error } = await supabase
    .from('reservation')
    .upsert(upsertRow, { onConflict: 'hospitable_id' })
    .select('id').single()

  if (error) { console.error('Upsert error:', error); return }

  if (fees.length > 0 && upserted?.id) {
    await supabase.from('reservation_fee').delete().eq('reservation_id', upserted.id)
    await supabase.from('reservation_fee').insert(
      fees.map((f: any) => ({
        reservation_id: upserted.id,
        label: f.label, amount: f.amount,
        category: f.category, currency: fin.currency || 'EUR',
        fee_type: f.fee_type, formatted: f.formatted,
      }))
    )
  }
  console.log('Upserted:', data.code, event)
}

async function handleProperty(supabase: any, event: string, data: any) {
  const hospId = data.id || data.uuid
  if (!hospId) return
  await supabase.from('bien').update({
    hospitable_name: data.name,
    adresse: data.address?.street,
    ville: data.address?.city,
    listed: data.listed ?? true,
    derniere_sync: new Date().toISOString(),
  }).eq('hospitable_id', hospId)
  console.log('Property updated:', hospId)
}
