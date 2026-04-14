import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const twilioSid   = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom  = Deno.env.get('TWILIO_FROM_NUMBER')
  const googleUrl   = Deno.env.get('GOOGLE_REVIEW_URL')

  if (!twilioSid || !twilioToken || !twilioFrom || !googleUrl) {
    return json({ error: 'Twilio secrets non configurés' }, 500)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'JSON invalide' }, 400) }

  const { mode } = body

  // ─── TEST ───────────────────────────────────────────────
  if (mode === 'test') {
    const { phone, language = 'FR' } = body
    if (!phone) return json({ error: 'phone requis' }, 400)

    const smsBody = buildSmsBody('Test', 'Villa DCB', language, googleUrl)
    const result  = await sendSMS(twilioSid, twilioToken, twilioFrom, phone, smsBody)

    await supabase.from('sms_logs').insert({
      hospitable_reservation_id: null,
      guest_name:    'TEST',
      guest_phone:   phone,
      language,
      rating:        5,
      sms_body:      smsBody,
      status:        result.ok ? 'sent' : 'error',
      twilio_sid:    result.sid || null,
      error_message: result.ok ? null : result.error,
    })

    return json({ ok: result.ok, error: result.error || null })
  }

  // ─── CAMPAGNE ────────────────────────────────────────────
  if (mode === 'campaign') {
    const { reservations } = body
    if (!Array.isArray(reservations) || reservations.length === 0) {
      return json({ error: 'reservations[] requis' }, 400)
    }

    const results = []

    for (const r of reservations) {
      const lang       = detectSmsLang(r.guest_country)
      const firstName  = (r.guest_name || 'cher client').split(' ')[0]
      const smsBody    = buildSmsBody(firstName, r.property_name || 'notre villa', lang, googleUrl)
      const result     = await sendSMS(twilioSid, twilioToken, twilioFrom, r.guest_phone, smsBody)

      await supabase.from('sms_logs').insert({
        hospitable_reservation_id: r.hospitable_id || null,
        guest_name:    r.guest_name || null,
        guest_phone:   r.guest_phone,
        language:      lang,
        rating:        r.rating || 5,
        sms_body:      smsBody,
        status:        result.ok ? 'sent' : 'error',
        twilio_sid:    result.sid || null,
        error_message: result.ok ? null : result.error,
      })

      results.push({ hospitable_id: r.hospitable_id, ok: result.ok, error: result.error || null })
    }

    return json({ results })
  }

  return json({ error: 'mode inconnu (test | campaign)' }, 400)
})

// ─── Helpers ─────────────────────────────────────────────

async function sendSMS(sid: string, token: string, from: string, to: string, body: string) {
  try {
    const res  = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    })
    const data = await res.json()
    if (res.ok) return { ok: true, sid: data.sid as string }
    return { ok: false, error: data.message || JSON.stringify(data) }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

function detectSmsLang(country: string | null): string {
  if (!country) return 'FR'
  const c = country.toLowerCase()
  if (['united kingdom', 'uk', 'ireland', 'united states', 'usa', 'us', 'australia', 'canada', 'new zealand'].includes(c)) return 'EN'
  if (['spain', 'españa', 'es', 'mexico', 'méxico', 'argentina', 'colombia', 'chile'].includes(c)) return 'ES'
  return 'FR'
}

function buildSmsBody(firstName: string, property: string, lang: string, googleUrl: string): string {
  const t: Record<string, string> = {
    FR: `Bonjour ${firstName} ! Merci pour votre avis 5⭐ sur ${property}. Votre retour compte beaucoup pour nous ! Partager aussi sur Google : ${googleUrl} — L'équipe DCB. Rép. STOP pour se désabonner.`,
    EN: `Hello ${firstName}! Thank you for your 5-star review of ${property}. Your feedback means a lot! Share on Google too: ${googleUrl} — DCB Team. Reply STOP to unsubscribe.`,
    ES: `¡Hola ${firstName}! Gracias por tu reseña 5⭐ de ${property}. ¡Tu opinión nos importa! Comparte en Google: ${googleUrl} — Equipo DCB. STOP para darse de baja.`,
  }
  return t[lang] ?? t['FR']
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
