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
  checkoutDate?: string | null
}): Promise<string> {
  const { firstName, property, lang, googleUrl, review, guestMessages, agenceLabel, platform, checkoutDate } = opts
  const googleUrlDisplay = googleUrl.replace(/^https?:\/\//, '')

  // Calculer si le séjour est ancien (> 30 jours)
  const checkoutMs = checkoutDate ? new Date(checkoutDate).getTime() : null
  const daysAgo = checkoutMs ? Math.floor((Date.now() - checkoutMs) / 86_400_000) : null
  const isOldStay = daysAgo !== null && daysAgo > 30
  const stayMonthLabel = checkoutMs ? new Date(checkoutMs).toLocaleDateString(
    lang === 'FR' ? 'fr-FR' : lang === 'ES' ? 'es-ES' : 'en-GB',
    { month: 'long', year: 'numeric' }
  ) : null
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

      const oldStayContext = isOldStay && stayMonthLabel
        ? `\n- Le séjour date de ${stayMonthLabel} (il y a ${daysAgo} jours) : explique naturellement en 1 phrase que tu viens de tomber sur son avis, sans t'excuser excessivement`
        : ''

      const prompt = `Tu es l'hôte de "${property}" pour ${agenceLabel}, agence de location de villas au Pays Basque.

${reviewPart}${histoPart}

Rédige un message de remerciement naturel et chaleureux en ${langLabel}, comme si l'hôte écrivait directement à son voyageur via la messagerie de la plateforme.

Règles STRICTES :
- Commence par "Bonjour ${firstName}," (ou équivalent dans la langue)
- ${review ? `Mentionne un élément précis de son commentaire${histoPart ? ' ou de la conversation' : ''}` : 'Remercie sincèrement pour le séjour'}
- Ton humain et direct, comme un vrai message d'hôte, pas une IA, pas du marketing
- Pas de tirets entre les idées, utilise des virgules ou des phrases séparées${oldStayContext}
- Invite à laisser un avis sur la fiche Google "${agenceLabel}" — sans lien, juste le nom de la fiche
- Signe uniquement "Oïhan" (pas "L'équipe", pas de formule longue)
- 4-5 phrases maximum, pas de blabla inutile

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
    FR: isOldStay && stayMonthLabel
      ? `Bonjour ${firstName},\n\nJe viens de tomber sur votre avis de ${stayMonthLabel} pour ${property}, et je voulais vous remercier, ça nous fait vraiment plaisir de lire ça. Si vous avez un moment, un avis sur notre fiche Google "${agenceLabel}" nous aiderait beaucoup.\n\nÀ bientôt,\nOïhan`
      : `Bonjour ${firstName},\n\nMerci beaucoup pour ce retour, ça nous touche vraiment ! C'est super de savoir que le séjour à ${property} vous a plu, on met beaucoup de soin à chaque accueil.\n\nSi vous avez un moment, n'hésitez pas à laisser un avis sur notre fiche Google "${agenceLabel}", ça nous aide énormément.\n\nÀ bientôt,\nOïhan`,
    EN: isOldStay && stayMonthLabel
      ? `Hello ${firstName},\n\nI just came across your review from ${stayMonthLabel} for ${property} and wanted to say a big thank you, it really means a lot! If you have a moment, a review on our Google listing "${agenceLabel}" would help us enormously.\n\nBest,\nOïhan`
      : `Hello ${firstName},\n\nThank you so much for your kind review, it really means a lot! We're so glad you enjoyed your stay at ${property}.\n\nIf you have a moment, feel free to leave a review on our Google listing "${agenceLabel}", it helps us more than you'd think.\n\nSee you soon,\nOïhan`,
    ES: isOldStay && stayMonthLabel
      ? `Hola ${firstName},\n\nAcabo de ver tu reseña de ${stayMonthLabel} sobre ${property} y quería agradecértelo, nos alegra muchísimo. Si tienes un momento, una reseña en nuestro perfil de Google "${agenceLabel}" nos ayudaría mucho.\n\nHasta pronto,\nOïhan`
      : `Hola ${firstName},\n\n¡Muchas gracias por tu reseña, nos alegra muchísimo! Es genial saber que disfrutaste tu estancia en ${property}.\n\nSi tienes un momento, nos ayudaría mucho que dejaras una reseña en nuestro perfil de Google "${agenceLabel}".\n\nHasta pronto,\nOïhan`,
  }
  return t[lang] ?? t['FR']
}
