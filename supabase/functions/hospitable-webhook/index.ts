import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let payload: any
  try { payload = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  const event = payload?.event
  const data  = payload?.data
  console.log('Webhook received:', event, JSON.stringify(data)?.substring(0, 200))

  if (!event || !data) return new Response('OK', { status: 200 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  let status  = 'ok'
  let message = ''

  try {
    if      (event.startsWith('reservation.')) { message = await handleReservation(supabase, event, data) }
    else if (event.startsWith('property.'))    { message = await handleProperty(supabase, event, data) }
    else if (event.startsWith('task.'))        { message = await handleTask(supabase, event, data) }
    else { message = 'event not handled' }
  } catch (err: any) {
    console.error('Webhook error:', err)
    status  = 'error'
    message = err?.message || String(err)
  }

  // Tracer dans webhook_log
  try {
    await supabase.from('webhook_log').insert({
      event, data_id: data.id || data.uuid || null,
      status, message, payload
    })
  } catch (_) {}

  return new Response('OK', { status: 200 })
})

// ============================================================
// RESERVATIONS
// ============================================================
async function handleReservation(supabase: any, event: string, data: any): Promise<string> {
  const hospId = data.id || data.uuid
  if (!hospId) return 'no hospitable_id'

  // --- Annulation ---
  if (event === 'reservation.cancelled') {
    const { data: resa } = await supabase
      .from('reservation')
      .select('id, mois_comptable')
      .eq('hospitable_id', hospId)
      .single()

    await supabase.from('reservation')
      .update({ final_status: 'cancelled', ventilation_calculee: false })
      .eq('hospitable_id', hospId)

    if (resa?.id) {
      // Supprimer la ventilation existante
      await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
      console.log('Ventilation supprim\u00e9e (annulation):', hospId)
    }
    return 'cancelled + ventilation deleted'
  }

  if (!['reservation.created', 'reservation.modified', 'reservation.updated'].includes(event)) {
    return 'event skipped'
  }

  const propertyId = data.property_id
  if (!propertyId) return 'no property_id'

  const { data: bien } = await supabase
    .from('bien')
    .select('id, proprietaire_id, provision_ae_ref, has_ae, taux_commission_override, proprietaire(id, taux_commission)')
    .eq('hospitable_id', propertyId)
    .single()

  if (!bien) return 'bien not found: ' + propertyId

  const fin        = data.financials?.host || {}
  const fees       = [
    ...(fin.guest_fees   || []).map((f: any) => ({ ...f, fee_type: 'guest_fee' })),
    ...(fin.host_fees    || []).map((f: any) => ({ ...f, fee_type: 'host_fee' })),
    ...(fin.taxes        || []).map((f: any) => ({ ...f, fee_type: 'tax' })),
    ...(fin.adjustments  || []).map((f: any) => ({ ...f, fee_type: 'adjustment' })),
  ]

  const arrival        = data.arrival_date?.substring(0, 10)
  const moisComptable  = arrival?.substring(0, 7) || null
  const finalStatus    = data.reservation_status?.current?.category || data.status || 'accepted'
  const guestName      =
    data.guest?.name ||
    data.guest_name  ||
    (Array.isArray(data.guests) ? data.guests?.[0]?.name : null) ||
    null

  const platform = data.platform === 'booking.com' ? 'booking' : (data.platform || 'direct')

  const resaRow: any = {
    hospitable_id:       hospId,
    bien_id:             bien.id,
    code:                data.code,
    platform,
    platform_id:         data.platform_id,
    arrival_date:        arrival,
    departure_date:      data.departure_date?.substring(0, 10),
    nights:              data.nights,
    guest_count:         (Array.isArray(data.guests) ? data.guests?.reduce((s: number, g: any) => s + (g.count || 1), 0) : data.guests?.total) || null,
    stay_type:           data.stay_type || 'guest',
    owner_stay:          data.owner_stay || false,
    reservation_status:  data.reservation_status,
    final_status:        finalStatus,
    fin_accommodation:   fin.accommodation?.amount ?? null,
    fin_revenue:         fin.revenue?.amount ?? null,
    fin_host_service_fee:(fin.host_fees || []).reduce((s: number, f: any) => s + f.amount, 0) || null,
    fin_taxes_total:     (fin.taxes     || []).reduce((s: number, t: any) => s + t.amount, 0) || null,
    fin_currency:        fin.currency || 'EUR',
    mois_comptable:      moisComptable,
    hospitable_raw:      data,
    synced_at:           new Date().toISOString(),
  }

  // Ne pas \u00e9craser guest_name si null
  if (guestName) resaRow.guest_name = guestName

  const { data: upserted, error } = await supabase
    .from('reservation')
    .upsert(resaRow, { onConflict: 'hospitable_id' })
    .select('id')
    .single()

  if (error) throw new Error('Upsert error: ' + JSON.stringify(error))

  // Upsert fees
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

  // Ventilation automatique
  if (moisComptable && upserted?.id) {
    if (finalStatus === 'cancelled' || finalStatus === 'not accepted') {
      await supabase.from('ventilation').delete().eq('reservation_id', upserted.id)
    } else {
      const { error: ventError } = await supabase.rpc('ventiler_toutes_resas', {
        p_mois_debut: moisComptable,
        p_mois_fin:   moisComptable,
      })
      if (ventError) console.error('Ventilation error:', ventError)
    }
  }

  console.log('Upserted:', data.code, event)
  return 'upserted ' + data.code
}

// ============================================================
// PROPERTIES
// ============================================================
async function handleProperty(supabase: any, event: string, data: any): Promise<string> {
  const hospId = data.id || data.uuid
  if (!hospId) return 'no hospitable_id'

  if (event === 'property.created') {
    // V\u00e9rifier si le bien existe d\u00e9j\u00e0
    const { data: existing } = await supabase
      .from('bien')
      .select('id')
      .eq('hospitable_id', hospId)
      .single()

    if (!existing) {
      // Cr\u00e9er le bien avec les infos de base
      await supabase.from('bien').insert({
        hospitable_id:   hospId,
        hospitable_name: data.name,
        adresse:         data.address?.street,
        ville:           data.address?.city,
        listed:          data.listed ?? true,
        has_ae:          true,
        agence:          'dcb',
        gestion_loyer:   true,
        derniere_sync:   new Date().toISOString(),
      })
      console.log('Bien created:', hospId, data.name)
      return 'bien created: ' + data.name
    }
    return 'bien already exists'
  }

  if (event === 'property.updated' || event === 'property.modified') {
    await supabase.from('bien').update({
      hospitable_name: data.name,
      adresse:         data.address?.street,
      ville:           data.address?.city,
      listed:          data.listed ?? true,
      derniere_sync:   new Date().toISOString(),
    }).eq('hospitable_id', hospId)
    return 'bien updated: ' + hospId
  }

  if (event === 'property.deleted' || event === 'property.unlisted') {
    await supabase.from('bien').update({ listed: false }).eq('hospitable_id', hospId)
    return 'bien unlisted: ' + hospId
  }

  return 'property event: ' + event
}

// ============================================================
// TASKS (missions m\u00e9nage)
// ============================================================
async function handleTask(supabase: any, event: string, data: any): Promise<string> {
  if (event === 'task.deleted') {
    if (data.id) {
      await supabase.from('mission_menage')
        .update({ statut: 'annulee' })
        .eq('ical_uid', data.id)
    }
    return 'task deleted: ' + data.id
  }

  if (!['task.created', 'task.updated', 'task.modified'].includes(event)) {
    return 'task event skipped: ' + event
  }

  const propertyId = data.property_id
  if (!propertyId) return 'no property_id'

  // Trouver le bien
  const { data: bien } = await supabase
    .from('bien')
    .select('id, ical_code')
    .eq('hospitable_id', propertyId)
    .single()

  if (!bien) return 'bien not found: ' + propertyId

  // Trouver l'AE associ\u00e9 au bien
  const { data: ae } = await supabase
    .from('auto_entrepreneur')
    .select('id')
    .contains('biens_ids', [bien.id])
    .single()
    .catch(() => ({ data: null }))

  const taskDate  = data.date?.substring(0, 10) || data.scheduled_at?.substring(0, 10)
  const taskMois  = taskDate?.substring(0, 7)
  const isCleaning = (data.type || data.task_type || '').toLowerCase().includes('clean') ||
                     (data.title || '').toLowerCase().includes('clean') ||
                     (data.title || '').toLowerCase().includes('m\u00e9nage')

  if (!isCleaning) return 'task not cleaning, skipped'
  if (!taskDate)   return 'no task date'

  await supabase.from('mission_menage').upsert({
    bien_id:       bien.id,
    ae_id:         ae?.id || null,
    date_mission:  taskDate,
    ical_uid:      data.id || data.uuid,
    titre_ical:    data.title || ('Cleaning ' + (bien.ical_code || '')),
    statut:        event === 'task.deleted' ? 'annulee' : 'planifiee',
    mois:          taskMois,
    type_mission:  'menage',
  }, { onConflict: 'ical_uid', ignoreDuplicates: false })

  return 'task upserted: ' + taskDate + ' ' + bien.id
}
