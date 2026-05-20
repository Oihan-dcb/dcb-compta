// Helpers Hospitable API — partagés entre les edge functions reviews

export const HOSP_BASE = 'https://public.api.hospitable.com/v2'

// ─── Données réservation (guest, review, plateforme) ──────
export async function getHospReservation(token: string, uuid: string) {
  try {
    const res = await fetch(`${HOSP_BASE}/reservations/${uuid}?include=guest,review`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) { console.error('getHospReservation', res.status, uuid); return null }
    const data = await res.json()
    return data.data || null
  } catch (err: any) {
    console.error('getHospReservation error:', err?.message)
    return null
  }
}

// ─── Messages du voyageur sur le fil de réservation ───────
export async function getHospGuestMessages(token: string, uuid: string): Promise<string[]> {
  try {
    const res = await fetch(`${HOSP_BASE}/reservations/${uuid}/messages`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = await res.json()
    const messages: any[] = data.data || []
    // Garder uniquement les messages du voyageur, hors messages automatiques courts
    return messages
      .filter(m => m.type === 'guest' && typeof m.body === 'string' && m.body.trim().length > 10)
      .map(m => m.body.trim())
      .slice(-6) // 6 derniers messages voyageur suffisent
  } catch (err: any) {
    console.error('getHospGuestMessages error:', err?.message)
    return []
  }
}

// ─── Envoi d'un message sur le fil de réservation ─────────
export async function sendHospMessage(token: string, uuid: string, body: string) {
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
    const data = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true, id: data.data?.id || null }
    const errDetail = data.message || data.error || (data.errors ? JSON.stringify(data.errors) : null) || JSON.stringify(data)
    const errMsg = errDetail && errDetail !== '{}' ? errDetail : `HTTP ${res.status}`
    console.error('sendHospMessage error:', res.status, JSON.stringify(data))
    return { ok: false, error: errMsg }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

// ─── Détection de langue ──────────────────────────────────
export function detectLang(locale: string | null, country: string | null, phone: string | null): string {
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

// ─── Génération du message via LLM ───────────────────────
export async function generateMessage(opts: {
  firstName: string
  property: string
  lang: string
  googleUrl: string
  review: string | null
  guestMessages: string[]
  agenceLabel: string
  platform: string | null
}): Promise<string> {
  const { firstName, property, lang, googleUrl, review, guestMessages, agenceLabel, platform } = opts
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const langLabel    = lang === 'FR' ? 'français' : lang === 'EN' ? 'anglais' : 'espagnol'
  const platformLabel = platform
    ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()
    : 'Airbnb'

  if (anthropicKey) {
    try {
      const reviewPart = review
        ? `Le voyageur a laissé l'avis suivant sur ${platformLabel} pour "${property}" :\n"${review}"`
        : `Le voyageur a séjourné dans "${property}" et a laissé un avis 5⭐ sur ${platformLabel}.`

      const histoPart = guestMessages.length > 0
        ? `\n\nHistorique de ses messages pendant le séjour (extraits) :\n${guestMessages.map(m => `- "${m}"`).join('\n')}`
        : ''

      const prompt = `Tu es l'hôte de "${property}" pour ${agenceLabel}, agence de location de villas au Pays Basque.

${reviewPart}${histoPart}

Rédige un message de remerciement naturel et chaleureux en ${langLabel}, comme si l'hôte écrivait directement à son voyageur via la messagerie de la plateforme. Ce n'est PAS un SMS : sois conversationnel (4-6 phrases), authentique, sans fioritures marketing.

Règles :
- Commence par "Bonjour ${firstName}," (ou équivalent dans la langue)
- ${review ? `Mentionne un élément précis et sincère de son commentaire${histoPart ? ', ou un échange de la conversation si pertinent' : ''}` : 'Remercie sincèrement pour le séjour'}
- Ton naturel d'hôte, pas commercial
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

  // Fallback sans LLM
  const t: Record<string, string> = {
    FR: `Bonjour ${firstName},\n\nMerci beaucoup pour votre avis 5⭐ sur "${property}" ! Votre retour nous touche vraiment et nous sommes ravis que le séjour vous ait plu.\n\nSi vous avez un moment, un avis Google nous aiderait beaucoup :\n${googleUrl}\n\nÀ très bientôt,\nL'équipe ${agenceLabel}`,
    EN: `Hello ${firstName},\n\nThank you so much for your 5-star review of "${property}"! We're really glad you enjoyed your stay and your kind words mean a lot to us.\n\nIf you have a moment, a Google review would help us greatly:\n${googleUrl}\n\nWarm regards,\nThe ${agenceLabel} team`,
    ES: `Hola ${firstName},\n\n¡Muchas gracias por tu reseña 5⭐ de "${property}"! Nos alegra mucho que hayas disfrutado tu estancia.\n\nSi tienes un momento, una reseña en Google nos ayudaría mucho:\n${googleUrl}\n\nHasta pronto,\nEl equipo de ${agenceLabel}`,
  }
  return t[lang] ?? t['FR']
}
