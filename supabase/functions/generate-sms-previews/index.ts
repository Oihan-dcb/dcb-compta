import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const googleUrl = Deno.env.get('GOOGLE_REVIEW_URL') || await (async () => {
    const agence = Deno.env.get('AGENCE') || 'dcb'
    const { data } = await supabase.from('agency_config').select('google_review_url').eq('agence', agence).single()
    return data?.google_review_url || null
  })()

  if (!googleUrl) return json({ error: 'google_review_url non configuré' }, 500)

  // Récupérer tous les pending sans preview_body
  const { data: items, error } = await supabase
    .from('sms_queue')
    .select('id, guest_name, guest_phone, guest_country, property_name, comment, rating')
    .eq('status', 'pending')
    .is('preview_body', null)

  if (error) return json({ error: error.message }, 500)
  if (!items?.length) return json({ updated: 0 })

  let updated = 0
  for (const item of items) {
    const preview = await generatePreviewBody(
      item.guest_name, item.property_name || 'notre villa',
      item.guest_country, item.guest_phone, item.comment, googleUrl
    ).catch(() => null)

    if (preview) {
      await supabase.from('sms_queue').update({ preview_body: preview }).eq('id', item.id)
      updated++
    }
  }

  return json({ updated, total: items.length })
})

function detectSmsLang(country: string | null, phone: string | null = null): string {
  if (phone) {
    const p = phone.replace(/\s/g, '')
    if (/^\+33/.test(p) || /^\+32/.test(p) || /^\+41/.test(p) || /^\+352/.test(p)) return 'FR'
    if (/^\+34/.test(p) || /^\+52/.test(p) || /^\+54/.test(p) || /^\+57/.test(p) || /^\+56/.test(p)) return 'ES'
    if (/^\+/.test(p)) return 'EN'
  }
  if (country) {
    const c = country.toLowerCase()
    if (['united kingdom','uk','ireland','united states','usa','us','australia','canada','new zealand'].includes(c)) return 'EN'
    if (['spain','españa','mexico','méxico','argentina','colombia','chile'].includes(c)) return 'ES'
  }
  return 'FR'
}

async function generatePreviewBody(
  guestName: string | null, propertyName: string, guestCountry: string | null,
  guestPhone: string | null, comment: string | null, googleUrl: string
): Promise<string> {
  const firstName = (guestName || 'cher client').split(' ')[0]
  const lang = detectSmsLang(guestCountry, guestPhone)
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const langLabel = lang === 'FR' ? 'français' : lang === 'EN' ? 'anglais' : 'espagnol'

  if (anthropicKey && comment) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: `Tu es l'assistant de Destination Côte Basque. Un voyageur vient de laisser un avis 5⭐ sur Airbnb pour "${propertyName}". Son commentaire : "${comment}"\nRédige un SMS de remerciement en ${langLabel} (160-220 caractères). Règles STRICTES :\n- N'inclus AUCUNE URL, AUCUN lien, AUCUN placeholder dans le texte\n- Termine par "— Destination Côte Basque"\n- Termine par cette phrase exacte selon la langue : FR: "Soutenez-nous sur Google →" / EN: "Support us on Google →" / ES: "Apóyanos en Google →"\n- Sans mention STOP\nRéponds uniquement avec le texte du SMS, le lien Google sera ajouté automatiquement après.` }],
        }),
      })
      if (res.ok) {
        const d = await res.json()
        const text = d.content?.[0]?.text?.trim()
        if (text) return `${firstName}, ${text}\n${googleUrl}`
      }
    } catch (_) {}
  }

  const t: Record<string, string> = {
    FR: `${firstName}, merci pour votre avis 5⭐ Airbnb sur ${propertyName} ! Votre retour nous touche beaucoup. Soutenez-nous sur Google → — Destination Côte Basque\n${googleUrl}`,
    EN: `${firstName}, thank you for your 5-star Airbnb review of ${propertyName}! Your feedback means so much to us. Support us on Google → — Destination Côte Basque\n${googleUrl}`,
    ES: `${firstName}, ¡gracias por tu reseña 5⭐ de Airbnb sobre ${propertyName}! Tu opinión nos llena de alegría. Apóyanos en Google → — Destination Côte Basque\n${googleUrl}`,
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
