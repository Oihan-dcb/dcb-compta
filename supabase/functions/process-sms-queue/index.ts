import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const twilioSid   = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom  = Deno.env.get('TWILIO_FROM_NUMBER')
  const googleUrl   = Deno.env.get('GOOGLE_REVIEW_URL')

  if (!twilioSid || !twilioToken || !twilioFrom || !googleUrl) {
    return json({ error: 'Twilio secrets non configurés' }, 500)
  }

  // Récupère les SMS prêts à envoyer
  const { data: pending, error } = await supabase
    .from('sms_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('send_at', new Date().toISOString())
    .limit(20)

  if (error) return json({ error: error.message }, 500)
  if (!pending?.length) return json({ processed: 0 })

  let sent = 0, failed = 0

  for (const item of pending) {
    // Marquer en cours pour éviter double-envoi
    await supabase.from('sms_queue')
      .update({ status: 'sent' }) // optimistic lock
      .eq('id', item.id)
      .eq('status', 'pending')

    const lang    = detectSmsLang(item.guest_country, item.guest_phone)
    const firstName = (item.guest_name || 'cher client').split(' ')[0]
    const smsBody = await generateSmsBody(firstName, item.property_name || 'notre villa', lang, googleUrl, item.comment || null)

    let status       = 'error'
    let twilioSidOut = null
    let errorMsg     = null

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ From: twilioFrom, To: item.guest_phone, Body: smsBody }).toString(),
        }
      )
      const data = await res.json()
      if (res.ok) {
        status       = 'sent'
        twilioSidOut = data.sid || null
        console.log('SMS sent (queue):', item.guest_phone, data.sid)
        sent++
      } else {
        errorMsg = JSON.stringify(data)
        console.error('Twilio error:', errorMsg)
        failed++
      }
    } catch (err: any) {
      errorMsg = err?.message || String(err)
      console.error('SMS fetch error:', errorMsg)
      failed++
    }

    // Mettre à jour la queue avec le résultat final
    await supabase.from('sms_queue').update({
      status:        status,
      twilio_sid:    twilioSidOut,
      error_message: errorMsg,
    }).eq('id', item.id)

    // Logger dans sms_logs
    await supabase.from('sms_logs').insert({
      hospitable_reservation_id: item.hospitable_reservation_id,
      guest_name:    item.guest_name,
      guest_phone:   item.guest_phone,
      language:      lang,
      rating:        item.rating || 5,
      sms_body:      smsBody,
      status,
      twilio_sid:    twilioSidOut,
      error_message: errorMsg,
    })
  }

  return json({ processed: pending.length, sent, failed })
})

// ─── Helpers ─────────────────────────────────────────────

function detectSmsLang(country: string | null, phone: string | null = null): string {
  if (phone) {
    const p = phone.replace(/\s/g, '')
    if (/^\+33/.test(p) || /^\+32/.test(p) || /^\+41/.test(p) || /^\+352/.test(p)) return 'FR'
    if (/^\+34/.test(p) || /^\+52/.test(p) || /^\+54/.test(p) || /^\+57/.test(p) || /^\+56/.test(p)) return 'ES'
    if (/^\+1/.test(p)  || /^\+44/.test(p) || /^\+61/.test(p) || /^\+64/.test(p) || /^\+353/.test(p)) return 'EN'
    if (/^\+/.test(p)) return 'EN'
  }
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
- Remercie chaleureusement en mentionnant un élément précis du commentaire
- Reste entre 160 et 220 caractères (sans compter le lien Google)
- Se termine OBLIGATOIREMENT par cette phrase d'invitation Google, puis la signature, dans cet ordre exact :
  FR : "Laissez-nous aussi un avis Google (1 clic) ↓ — Destination Côte Basque"
  EN : "Leave us a Google review too (1 click) ↓ — Destination Côte Basque"
  ES : "Déjanos también una reseña en Google (1 clic) ↓ — Destination Côte Basque"
- Le lien Google sera ajouté automatiquement après la signature, ne l'inclus pas
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
    FR: `${firstName}, merci pour votre avis 5⭐ Airbnb sur ${property} ! Votre retour nous touche beaucoup. Laissez-nous aussi un avis Google (1 clic) ↓ — Destination Côte Basque\n${googleUrl}`,
    EN: `${firstName}, thank you for your 5-star Airbnb review of ${property}! Your feedback means so much to us. Leave us a Google review too (1 click) ↓ — Destination Côte Basque\n${googleUrl}`,
    ES: `${firstName}, ¡gracias por tu reseña 5⭐ de Airbnb sobre ${property}! Tu opinión nos llena de alegría. Déjanos también una reseña en Google (1 clic) ↓ — Destination Côte Basque\n${googleUrl}`,
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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  }
}
