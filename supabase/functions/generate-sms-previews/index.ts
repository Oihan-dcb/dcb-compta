import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getHospReservation, getHospGuestMessages, detectLang, generateMessage
} from '../_shared/hosp.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const hospToken = Deno.env.get('HOSPITABLE_TOKEN')

  const googleUrl = Deno.env.get('GOOGLE_REVIEW_URL') || await (async () => {
    const agence = Deno.env.get('AGENCE') || 'dcb'
    const { data } = await supabase.from('agency_config').select('google_review_url').eq('agence', agence).single()
    return data?.google_review_url || null
  })()
  if (!googleUrl) return json({ error: 'google_review_url non configuré' }, 500)

  const { data: items, error } = await supabase
    .from('sms_queue')
    .select('id, guest_name, guest_country, property_name, comment, rating, agence_label, hospitable_reservation_id')
    .eq('status', 'pending')
    .is('preview_body', null)

  if (error) return json({ error: error.message }, 500)
  if (!items?.length) return json({ updated: 0 })

  let updated = 0
  for (const item of items) {
    let firstName     = (item.guest_name || 'cher client').split(' ')[0]
    let locale        = null
    let reviewText    = item.comment || null
    let propName      = item.property_name || 'notre villa'
    let platform      = null
    let guestMessages: string[] = []

    if (hospToken && item.hospitable_reservation_id) {
      const [hosp, msgs] = await Promise.all([
        getHospReservation(hospToken, item.hospitable_reservation_id),
        getHospGuestMessages(hospToken, item.hospitable_reservation_id),
      ])
      if (hosp) {
        firstName  = hosp.guest?.first_name || firstName
        locale     = hosp.guest?.locale || null
        reviewText = hosp.review?.guest_comment || reviewText
        propName   = hosp.listing?.name || propName
        platform   = hosp.platform || null
      }
      guestMessages = msgs
    }

    const lang        = detectLang(locale, item.guest_country, null)
    const agenceLabel = item.agence_label || 'Destination Côte Basque'

    const preview = await generateMessage({
      firstName, property: propName, lang, googleUrl,
      review: reviewText, guestMessages, agenceLabel, platform,
    }).catch(() => null)

    if (preview) {
      await supabase.from('sms_queue').update({ preview_body: preview }).eq('id', item.id)
      updated++
    }
  }

  return json({ updated, total: items.length })
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
