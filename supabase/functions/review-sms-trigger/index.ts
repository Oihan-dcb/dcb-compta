import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HOSP_BASE            = 'https://public.api.hospitable.com/v2'

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
    .from('agency_config')
    .select('label, google_review_url')
    .eq('agence', agence)
    .single()

  const googleUrl   = agenceCfg?.google_review_url || (agence === 'dcb' ? Deno.env.get('GOOGLE_REVIEW_URL') : null)
  const agenceLabel = agenceCfg?.label || agence.toUpperCase()

  if (!googleUrl) return json({ error: `google_review_url non configuré pour agence=${agence}` }, 500)

  // ─── TEST — génère un aperçu sans envoyer ─────────────────
  if (mode === 'test') {
    const { hospitable_id, comment = null, property = agenceLabel } = body

    const hosp = hospitable_id ? await getHospReservation(hospToken, hospitable_id) : null
    const firstName  = hosp?.guest?.first_name || 'cher client'
    const locale     = hosp?.guest?.locale || null
    const reviewText = hosp?.review?.guest_comment || comment || null
    const propName   = hosp?.listing?.name || property
    const platform   = hosp?.platform || null
    const lang       = detectLang(locale, null, null)

    const msgBody = await generateMessage(firstName, propName, lang, googleUrl, reviewText, agenceLabel, platform)

    return json({ ok: true, preview: msgBody, lang, guest: firstName, property: propName })
  }

  // ─── CAMPAGNE ──────────────────────────────────────────────
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

      // Enrichir depuis Hospitable (review live, locale, plateforme)
      const hosp = await getHospReservation(hospToken, hospId)
      const firstName  = hosp?.guest?.first_name || (r.guest_name || 'cher client').split(' ')[0]
      const locale     = hosp?.guest?.locale || r.guest_locale || null
      const reviewText = hosp?.review?.guest_comment || r.comment || null
      const propName   = hosp?.listing?.name || r.property_name || agenceLabel
      const platform   = hosp?.platform || null
      const lang       = detectLang(locale, r.guest_country, null)

      const msgBody = await generateMessage(firstName, propName, lang, googleUrl, reviewText, agenceLabel, platform)
      const result  = await sendHospMessage(hospToken, hospId, msgBody)

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

// ─── Hospitable API ────────────────────────────────────────

async function getHospReservation(token: string, uuid: string) {
  try {
    const res = await fetch(`${HOSP_BASE}/reservations/${uuid}?include=guest,review`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) { console.error('Hospitable getReservation error:', res.status, uuid); return null }
    const data = await res.json()
    return data.data || null
  } catch (err: any) {
    console.error('getHospReservation error:', err?.message)
    return null
  }
}

async function sendHospMessage(token: string, uuid: string, body: string) {
  try {
    const res = await fetch(`${HOSP_BASE}/reservations/${uuid}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ body }),
    })
    const data = await res.json()
    if (res.ok) return { ok: true, id: data.data?.id || null }
    console.error('Hospitable sendMessage error:', res.status, JSON.stringify(data))
    return { ok: false, error: data.message || data.error || `HTTP ${res.status}` }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

// ─── Langue ───────────────────────────────────────────────

function detectLang(locale: string | null, country: string | null, phone: string | null): string {
  if (locale) {
    const l = locale.toLowerCase().split('-')[0].split('_')[0]
    if (l === 'fr') return 'FR'
    if (l === 'es') return 'ES'
    if (['en', 'de', 'nl', 'it', 'pt', 'pl', 'ru', 'zh', 'ja', 'ko', 'ar', 'sv', 'da', 'no', 'fi'].includes(l)) return 'EN'
  }
  if (phone) {
    const p = phone.replace(/\s/g, '')
    if (/^\+33|^\+32|^\+41|^\+352/.test(p)) return 'FR'
    if (/^\+34|^\+52|^\+54|^\+57|^\+56/.test(p)) return 'ES'
    if (/^\+/.test(p)) return 'EN'
  }
  if (country) {
    const c = country.toLowerCase()
    if (['uk', 'ireland', 'united states', 'usa', 'australia', 'canada'].includes(c)) return 'EN'
    if (['spain', 'españa', 'mexico', 'argentina', 'colombia'].includes(c)) return 'ES'
  }
  return 'FR'
}

// ─── Génération message ────────────────────────────────────

async function generateMessage(
  firstName: string, property: string, lang: string, googleUrl: string,
  review: string | null, agenceLabel: string, platform: string | null
): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const langLabel = lang === 'FR' ? 'français' : lang === 'EN' ? 'anglais' : 'espagnol'
  const platformLabel = platform
    ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()
    : 'Airbnb'

  if (anthropicKey) {
    try {
      const reviewPart = review
        ? `Le voyageur a laissé l'avis suivant sur ${platformLabel} pour "${property}" :\n"${review}"`
        : `Le voyageur a séjourné dans "${property}" et a laissé un avis 5⭐ sur ${platformLabel}.`

      const prompt = `Tu es l'hôte de "${property}" pour ${agenceLabel}, agence de location de villas au Pays Basque.

${reviewPart}

Rédige un message de remerciement naturel et chaleureux en ${langLabel}, comme si l'hôte écrivait directement à son voyageur via la messagerie de la plateforme. Ce n'est PAS un SMS : le message peut être conversationnel (4-6 phrases), authentique, sans fioritures marketing.

Règles :
- Commence par "Bonjour ${firstName}," (ou équivalent dans la langue)
- ${review ? 'Mentionne un élément précis et sincère de son commentaire, sans paraphraser mécaniquement' : 'Remercie sincèrement pour le séjour'}
- Ton naturel d'hôte qui a apprécié accueillir ce voyageur
- Glisse une invitation douce à laisser aussi un avis Google, avec ce lien sur une ligne séparée : ${googleUrl}
- Signe "L'équipe ${agenceLabel}"
- Pas de majuscules excessives, pas d'émoticônes multiples

Réponds uniquement avec le texte du message.`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const text = data.content?.[0]?.text?.trim()
        if (text) return text
      }
    } catch (err: any) {
      console.error('Claude API error, fallback:', err?.message)
    }
  }

  const t: Record<string, string> = {
    FR: `Bonjour ${firstName},\n\nMerci beaucoup pour votre avis 5⭐ sur "${property}" ! Votre retour nous touche vraiment et nous sommes ravis que le séjour vous ait plu.\n\nSi vous avez un moment, un avis Google nous aiderait beaucoup à faire connaître notre service :\n${googleUrl}\n\nÀ très bientôt,\nL'équipe ${agenceLabel}`,
    EN: `Hello ${firstName},\n\nThank you so much for your 5-star review of "${property}"! We're really glad you enjoyed your stay and your kind words mean a lot to us.\n\nIf you have a moment, a Google review would help us greatly:\n${googleUrl}\n\nWarm regards,\nThe ${agenceLabel} team`,
    ES: `Hola ${firstName},\n\n¡Muchas gracias por tu reseña 5⭐ de "${property}"! Nos alegra mucho que hayas disfrutado tu estancia y tus palabras nos llenan de alegría.\n\nSi tienes un momento, una reseña en Google nos ayudaría mucho:\n${googleUrl}\n\nHasta pronto,\nEl equipo de ${agenceLabel}`,
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
