import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getHospReservation, getHospGuestMessages, sendHospMessage, detectLang, generateMessage
} from '../_shared/hosp.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  const body  = await req.json().catch(() => ({}))
  const force = body?.force === true

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const hospToken = Deno.env.get('HOSPITABLE_TOKEN')
  if (!hospToken) return json({ error: 'HOSPITABLE_TOKEN non configuré' }, 500)

  let googleUrl = Deno.env.get('GOOGLE_REVIEW_URL') || null
  if (!googleUrl) {
    const agence = Deno.env.get('AGENCE') || 'dcb'
    const { data: agenceCfg } = await supabase
      .from('agency_config').select('google_review_url').eq('agence', agence).single()
    googleUrl = agenceCfg?.google_review_url || null
  }
  if (!googleUrl) return json({ error: 'google_review_url non configuré' }, 500)

  let query = supabase.from('sms_queue').select('*, agence_label').eq('status', 'pending').limit(20)
  if (!force) query = query.lte('send_at', new Date().toISOString())
  const { data: pending, error } = await query

  if (error) return json({ error: error.message }, 500)
  if (!pending?.length) return json({ processed: 0, sent: 0, failed: 0 })

  let sent = 0, failed = 0

  for (const item of pending) {
    await supabase.from('sms_queue').update({ status: 'sent' }).eq('id', item.id).eq('status', 'pending')

    const hospId = item.hospitable_reservation_id
    if (!hospId) {
      await supabase.from('sms_queue').update({ status: 'error', error_message: 'hospitable_reservation_id manquant' }).eq('id', item.id)
      failed++
      continue
    }

    const [hosp, guestMessages] = await Promise.all([
      getHospReservation(hospToken, hospId),
      getHospGuestMessages(hospToken, hospId),
    ])

    // Airbnb ferme le fil de discussion ~48h après le checkout — inutile d'essayer au-delà
    const checkoutRaw = hosp?.check_out || hosp?.departure_date || null
    const platform    = hosp?.platform || null
    if (platform === 'airbnb' && checkoutRaw) {
      const checkoutMs  = new Date(checkoutRaw).getTime()
      const hoursAgo    = (Date.now() - checkoutMs) / 3_600_000
      if (hoursAgo > 48) {
        const reason = `airbnb_thread_closed (checkout il y a ${Math.round(hoursAgo)}h)`
        await supabase.from('sms_queue').update({ status: 'skipped', error_message: reason }).eq('id', item.id)
        await supabase.from('sms_logs').insert({
          hospitable_reservation_id: hospId,
          guest_name: item.guest_name, guest_phone: null,
          language: 'FR', rating: item.rating || 5,
          sms_body: item.preview_body || '', status: 'skipped', error_message: reason,
        })
        failed++
        continue
      }
    }

    const firstName   = hosp?.guest?.first_name || (item.guest_name || 'cher client').split(' ')[0]
    const locale      = hosp?.guest?.locale || null
    const reviewText  = hosp?.review?.guest_comment || item.comment || null
    const propName    = hosp?.listing?.name || item.property_name || 'notre villa'
    const lang        = detectLang(locale, item.guest_country, null)
    const agenceLabel = item.agence_label || 'Destination Côte Basque'

    const msgBody = item.preview_body || await generateMessage({
      firstName, property: propName, lang, googleUrl,
      review: reviewText, guestMessages, agenceLabel, platform,
    })

    const result = await sendHospMessage(hospToken, hospId, msgBody)

    await supabase.from('sms_queue').update({
      status:        result.ok ? 'sent' : 'error',
      error_message: result.ok ? null : result.error,
    }).eq('id', item.id)

    await supabase.from('sms_logs').insert({
      hospitable_reservation_id: hospId,
      hospitable_message_id:     result.ok ? (result.id || null) : null,
      guest_name:                item.guest_name,
      guest_phone:               null,
      language:                  lang,
      rating:                    item.rating || 5,
      sms_body:                  msgBody,
      status:                    result.ok ? 'sent' : 'error',
      twilio_sid:                null,
      error_message:             result.ok ? null : result.error,
    })

    if (result.ok) sent++; else failed++
  }

  return json({ processed: pending.length, sent, failed })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  }
}
