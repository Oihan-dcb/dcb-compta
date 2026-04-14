import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
// Supabase injecte automatiquement SUPABASE_SERVICE_ROLE_KEY dans les Edge Functions
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

    const smsBody = await generateSmsBody('Test', 'Villa DCB', language, googleUrl, null)
    const result  = await sendSMS(twilioSid, twilioToken, twilioFrom, phone, smsBody)

    const { error: dbErr } = await supabase.from('sms_logs').insert({
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
    if (dbErr) console.error('sms_logs insert error (test):', JSON.stringify(dbErr))

    return json({ ok: result.ok, error: result.error || null, db_error: dbErr?.message || null })
  }

  // ─── CAMPAGNE ────────────────────────────────────────────
  if (mode === 'campaign') {
    const { reservations } = body
    if (!Array.isArray(reservations) || reservations.length === 0) {
      return json({ error: 'reservations[] requis' }, 400)
    }

    const results = []

    for (const r of reservations) {
      const lang       = detectSmsLang(r.guest_country, r.guest_locale, r.guest_phone)
      const firstName  = (r.guest_name || 'cher client').split(' ')[0]
      const smsBody    = await generateSmsBody(firstName, r.property_name || 'notre villa', lang, googleUrl, r.comment || null)
      const result     = await sendSMS(twilioSid, twilioToken, twilioFrom, r.guest_phone, smsBody)

      const { error: dbErr } = await supabase.from('sms_logs').insert({
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
      if (dbErr) console.error('sms_logs insert error (campaign):', JSON.stringify(dbErr))

      results.push({ hospitable_id: r.hospitable_id, ok: result.ok, error: result.error || null, db_error: dbErr?.message || null })
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

function detectSmsLang(country: string | null, locale: string | null = null, phone: string | null = null): string {
  // 1. Indicatif téléphonique — le plus fiable
  if (phone) {
    const p = phone.replace(/\s/g, '')
    if (/^\+33/.test(p) || /^\+32/.test(p) || /^\+41/.test(p) || /^\+352/.test(p)) return 'FR'
    if (/^\+34/.test(p) || /^\+52/.test(p) || /^\+54/.test(p) || /^\+57/.test(p) || /^\+56/.test(p)) return 'ES'
    if (/^\+1/.test(p)  || /^\+44/.test(p) || /^\+61/.test(p) || /^\+64/.test(p) || /^\+353/.test(p)) return 'EN'
    // Tout autre indicatif → EN (DE, NL, IT, PT, PL, etc.)
    if (/^\+/.test(p)) return 'EN'
  }
  // 2. Locale CSV (ex: "fr", "en-US", "de")
  if (locale) {
    const l = locale.toLowerCase().split('-')[0]
    if (l === 'fr') return 'FR'
    if (l === 'es') return 'ES'
    if (l === 'en') return 'EN'
    if (['de', 'nl', 'it', 'pt', 'pl', 'ru', 'zh', 'ja', 'ko', 'ar', 'sv', 'da', 'no', 'fi'].includes(l)) return 'EN'
  }
  // 3. Pays (fallback)
  if (country) {
    const c = country.toLowerCase()
    if (['united kingdom', 'uk', 'ireland', 'united states', 'usa', 'us', 'australia', 'canada', 'new zealand'].includes(c)) return 'EN'
    if (['spain', 'españa', 'mexico', 'méxico', 'argentina', 'colombia', 'chile'].includes(c)) return 'ES'
  }
  return 'FR'
}

async function generateSmsBody(
  firstName: string, property: string, lang: string, googleUrl: string, comment: string | null
): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const langLabel = lang === 'FR' ? 'français' : lang === 'EN' ? 'anglais' : 'espagnol'

  if (anthropicKey && comment) {
    try {
      const prompt = `Tu es l'assistant de Destination Côte Basque (DCB), agence de location de villas de luxe au Pays Basque français.

Un voyageur vient de laisser un avis 5⭐ sur Airbnb pour "${property}". Son commentaire :
"${comment}"

Rédige un SMS de remerciement en ${langLabel} qui :
- Mentionne que l'avis a été laissé sur Airbnb
- Remercie chaleureusement en mentionnant un élément précis du commentaire
- Reste entre 160 et 220 caractères (sans compter le lien Google)
- Se termine par "— Destination Côte Basque" (quelle que soit la langue)
- N'inclut PAS le lien Google (il sera ajouté automatiquement)
- N'inclut PAS de mention STOP ou désabonnement

Réponds uniquement avec le texte du SMS, sans guillemets ni balises.`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const text = data.content?.[0]?.text?.trim()
        if (text) return `${firstName}, ${text}\n${googleUrl}`
      }
    } catch (err: any) {
      console.error('Claude API error, fallback:', err?.message)
    }
  }

  const t: Record<string, string> = {
    FR: `Bonjour ${firstName} ! Merci pour votre avis 5⭐ Airbnb sur ${property}. Votre retour nous touche beaucoup ! Partagez-le aussi sur Google : ${googleUrl} — Destination Côte Basque`,
    EN: `Hello ${firstName}! Thank you for your 5-star Airbnb review of ${property}. Your feedback means so much to us! Share it on Google too: ${googleUrl} — Destination Côte Basque`,
    ES: `¡Hola ${firstName}! Gracias por tu reseña 5⭐ de Airbnb sobre ${property}. ¡Tu opinión nos llena de alegría! Compártela también en Google: ${googleUrl} — Destination Côte Basque`,
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
