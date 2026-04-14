import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const twilioSid   = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom  = Deno.env.get('TWILIO_FROM_NUMBER')

  if (!twilioSid || !twilioToken || !twilioFrom) {
    return json({ error: 'Twilio secrets manquants' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Récupère tous les messages envoyés depuis notre numéro (max 1000)
  const auth = 'Basic ' + btoa(`${twilioSid}:${twilioToken}`)
  const params = new URLSearchParams({
    From: twilioFrom,
    PageSize: '1000',
  })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json?${params}`,
    { headers: { Authorization: auth } }
  )
  if (!res.ok) {
    const err = await res.text()
    return json({ error: `Twilio API error: ${err}` }, 500)
  }

  const { messages } = await res.json()
  if (!messages?.length) return json({ inserted: 0, skipped: 0 })

  // Récupère les twilio_sid déjà en base pour éviter les doublons
  const { data: existing } = await supabase
    .from('sms_logs')
    .select('twilio_sid')
    .not('twilio_sid', 'is', null)
  const existingSids = new Set((existing || []).map((r: any) => r.twilio_sid))

  let inserted = 0
  let skipped  = 0
  const errors: string[] = []

  for (const msg of messages) {
    // On n'insère que les messages sortants (direction: outbound-api)
    if (msg.direction !== 'outbound-api') { skipped++; continue }
    if (existingSids.has(msg.sid)) { skipped++; continue }

    // Détecter la langue depuis le numéro destinataire
    const lang = detectLang(msg.to)

    const { error } = await supabase.from('sms_logs').insert({
      guest_phone:   msg.to,
      guest_name:    null,
      language:      lang,
      rating:        5,
      sms_body:      msg.body,
      status:        msg.status === 'delivered' || msg.status === 'sent' ? 'sent' : 'error',
      twilio_sid:    msg.sid,
      error_message: msg.error_message || null,
      sent_at:       msg.date_sent ? new Date(msg.date_sent).toISOString() : new Date().toISOString(),
    })

    if (error) {
      errors.push(`${msg.sid}: ${error.message}`)
    } else {
      inserted++
    }
  }

  return json({ inserted, skipped, errors })
})

function detectLang(phone: string | null): string {
  if (!phone) return 'FR'
  const p = phone.replace(/\s/g, '')
  if (/^\+33/.test(p) || /^\+32/.test(p) || /^\+41/.test(p) || /^\+352/.test(p)) return 'FR'
  if (/^\+34/.test(p) || /^\+52/.test(p) || /^\+54/.test(p) || /^\+57/.test(p) || /^\+56/.test(p)) return 'ES'
  return 'EN'
}
