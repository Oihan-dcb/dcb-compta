import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getHospReservation, getHospGuestMessages, sendHospMessage, detectLang, generateMessage
} from '../_shared/hosp.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const hospToken = Deno.env.get('HOSPITABLE_TOKEN')
  if (!hospToken) return json({ error: 'HOSPITABLE_TOKEN non configuré' }, 500)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'JSON invalide' }, 400) }

  const { mode, agence = 'dcb' } = body

  const { data: agenceCfg } = await supabase
    .from('agency_config').select('label, google_review_url').eq('agence', agence).single()

  const googleUrl   = agenceCfg?.google_review_url || (agence === 'dcb' ? Deno.env.get('GOOGLE_REVIEW_URL') : null)
  const agenceLabel = agenceCfg?.label || agence.toUpperCase()
  if (!googleUrl) return json({ error: `google_review_url non configuré pour agence=${agence}` }, 500)

  // ─── TEST — aperçu sans envoi ──────────────────────────────
  if (mode === 'test') {
    const { hospitable_id, comment = null, property = agenceLabel } = body

    const [hosp, guestMessages] = hospitable_id
      ? await Promise.all([
          getHospReservation(hospToken, hospitable_id),
          getHospGuestMessages(hospToken, hospitable_id),
        ])
      : [null, []]

    const firstName  = hosp?.guest?.first_name || 'cher client'
    const locale     = hosp?.guest?.locale || null
    const reviewText = hosp?.review?.guest_comment || comment || null
    const propName   = hosp?.listing?.name || property
    const platform   = hosp?.platform || null
    const lang       = detectLang(locale, null, null)

    const preview = await generateMessage({
      firstName, property: propName, lang, googleUrl,
      review: reviewText, guestMessages, agenceLabel, platform,
    })

    return json({ ok: true, preview, lang, guest: firstName, property: propName, nbMessages: guestMessages.length })
  }

  // ─── CAMPAGNE ─────────────────────────────────────────────
  if (mode === 'campaign') {
    const { reservations } = body
    if (!Array.isArray(reservations) || !reservations.length) {
      return json({ error: 'reservations[] requis' }, 400)
    }

    const results = []

    for (const r of reservations) {
      const hospId = r.hospitable_id
      if (!hospId) {
        results.push({ hospitable_id: null, ok: false, error: 'hospitable_id manquant' })
        continue
      }

      const [hosp, guestMessages] = await Promise.all([
        getHospReservation(hospToken, hospId),
        getHospGuestMessages(hospToken, hospId),
      ])

      const firstName  = hosp?.guest?.first_name || (r.guest_name || 'cher client').split(' ')[0]
      const locale     = hosp?.guest?.locale || r.guest_locale || null
      const reviewText = hosp?.review?.guest_comment || r.comment || null
      const propName   = hosp?.listing?.name || r.property_name || agenceLabel
      const platform   = hosp?.platform || null
      const lang       = detectLang(locale, r.guest_country, null)

      const msgBody = await generateMessage({
        firstName, property: propName, lang, googleUrl,
        review: reviewText, guestMessages, agenceLabel, platform,
      })
      const result = await sendHospMessage(hospToken, hospId, msgBody)

      await supabase.from('sms_logs').insert({
        hospitable_reservation_id: hospId,
        hospitable_message_id:     result.ok ? (result.id || null) : null,
        guest_name:                r.guest_name || firstName,
        guest_phone:               null,
        language:                  lang,
        rating:                    r.rating || 5,
        sms_body:                  msgBody,
        status:                    result.ok ? 'sent' : 'error',
        twilio_sid:                null,
        error_message:             result.ok ? null : result.error,
      })

      results.push({ hospitable_id: hospId, ok: result.ok, error: result.error || null })
    }

    return json({ results })
  }

  return json({ error: 'mode inconnu (test | campaign)' }, 400)
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
