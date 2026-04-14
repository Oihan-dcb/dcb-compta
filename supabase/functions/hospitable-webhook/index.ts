import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let payload: any
  try { payload = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  // Hospitable envoie {event,data} OU directement {id,code,guest,...} (Historical Data)
  let event = payload?.event || payload?.type || null
  let data   = payload?.data || (payload?.id ? payload : null)
  if (!data && payload?.code) { data = payload; event = event || 'reservation.updated' }
  if (!event && data?.id) event = 'reservation.updated'
  console.log('Webhook received:', event, data?.id, data?.code)


  if (!data) return new Response('OK', { status: 200 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  let status  = 'ok'
  let message = ''

  try {
    if      (event.startsWith('reservation.')) { message = await handleReservation(supabase, event, data) }
    else if (event.startsWith('property.'))    { message = await handleProperty(supabase, event, data) }
    else if (event.startsWith('message.'))     { message = await handleMessage(supabase, event, data) }
    else if (event.startsWith('review.'))      { message = await handleReview(supabase, event, data) }
    else { message = 'event not handled: ' + event }
  } catch (err: any) {
    console.error('Webhook error:', err)
    status  = 'error'
    message = err?.message || String(err)
  }

  // Tracer dans webhook_log
  try {
    await supabase.from('webhook_log').insert({
      event, data_id: data.id || data.uuid || null,
      status, message, payload
    })
  } catch (_) {}

  return new Response('OK', { status: 200 })
})

// ============================================================
// RESERVATIONS
// ============================================================
async function handleReservation(supabase: any, event: string, data: any): Promise<string> {
  const hospId = data.id || data.uuid
  if (!hospId) return 'no hospitable_id'

  // --- Annulation ---
  if (event === 'reservation.cancelled') {
    const { data: resa } = await supabase
      .from('reservation')
      .select('id, mois_comptable')
      .eq('hospitable_id', hospId)
      .single()

    await supabase.from('reservation')
      .update({ final_status: 'cancelled', ventilation_calculee: false })
      .eq('hospitable_id', hospId)

    if (resa?.id) {
      // Supprimer la ventilation existante
      await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
      console.log('Ventilation supprim\u00e9e (annulation):', hospId)
    }
    return 'cancelled + ventilation deleted'
  }

  if (!['reservation.created', 'reservation.modified', 'reservation.updated'].includes(event)) {
    return 'event skipped'
  }

  const propertyId = data.property_id
  if (!propertyId) return 'no property_id'

  const { data: bien } = await supabase
    .from('bien')
    .select('id, proprietaire_id, provision_ae_ref, has_ae, taux_commission_override, proprietaire(id, taux_commission)')
    .eq('hospitable_id', propertyId)
    .single()

  if (!bien) return 'bien not found: ' + propertyId

  const fin        = data.financials?.host || {}
  const fees       = [
    ...(fin.guest_fees   || []).map((f: any) => ({ ...f, fee_type: 'guest_fee' })),
    ...(fin.host_fees    || []).map((f: any) => ({ ...f, fee_type: 'host_fee' })),
    ...(fin.taxes        || []).map((f: any) => ({ ...f, fee_type: 'tax' })),
    ...(fin.adjustments  || []).map((f: any) => ({ ...f, fee_type: 'adjustment' })),
  ]

  const arrival        = data.arrival_date?.substring(0, 10)
  const moisComptable  = arrival?.substring(0, 7) || null
  const finalStatus    = data.reservation_status?.current?.category || data.status || 'accepted'
  const guestFirst    = data.guest?.first_name || null
  // guest_name : Hospitable webhook inclut guest.first_name + last_name dans les payloads
  const guestBuilt = [data.guest?.first_name, data.guest?.last_name].filter(Boolean).join(' ') || null
  const guestName =
    guestBuilt ||
    data.guest?.name ||
    data.guest_name  ||
    (Array.isArray(data.guests) ? data.guests?.[0]?.name : null) ||
    null

  const platform = data.platform === 'booking.com' ? 'booking' : (data.platform || 'direct')
  const resaRow: any = {
    hospitable_id:       hospId,
    bien_id:             bien.id,
    code:                data.code,
    platform,
    platform_id:         data.platform_id,
    arrival_date:        arrival,
    departure_date:      data.departure_date?.substring(0, 10),
    nights:              data.nights,
    guest_count:         (Array.isArray(data.guests) ? data.guests?.reduce((s: number, g: any) => s + (g.count || 1), 0) : data.guests?.total) || null,
    stay_type:           data.stay_type || 'guest',
    owner_stay:          data.owner_stay || false,
    reservation_status:  data.reservation_status,
    final_status:        finalStatus,
    fin_accommodation:   fin.accommodation?.amount ?? null,
    fin_revenue:         fin.revenue?.amount ?? null,
    fin_host_service_fee:(fin.host_fees || []).reduce((s: number, f: any) => s + f.amount, 0) || null,
    fin_taxes_total:     (fin.taxes     || []).reduce((s: number, t: any) => s + t.amount, 0) || null,
    fin_currency:        fin.currency || 'EUR',
    mois_comptable:      moisComptable,
    hospitable_raw:      data,
    synced_at:           new Date().toISOString(),
  }

  // Ne pas écraser guest_name/phone/country si null (préserver les données existantes)
  if (guestName) resaRow.guest_name = guestName
  const guestPhone   = data.guest?.phone || data.guest?.phone_number || null
  const guestCountry = data.guest?.country || data.guest?.nationality || null
  if (guestPhone)   resaRow.guest_phone   = guestPhone
  if (guestCountry) resaRow.guest_country = guestCountry

  const { data: upserted, error } = await supabase
    .from('reservation')
    .upsert(resaRow, { onConflict: 'hospitable_id' })
    .select('id')
    .single()

  if (error) throw new Error('Upsert error: ' + JSON.stringify(error))

  // Upsert fees
  if (fees.length > 0 && upserted?.id) {
    await supabase.from('reservation_fee').delete().eq('reservation_id', upserted.id)
    await supabase.from('reservation_fee').insert(
      fees.map((f: any) => ({
        reservation_id: upserted.id,
        label: f.label, amount: f.amount,
        category: f.category, currency: fin.currency || 'EUR',
        fee_type: f.fee_type, formatted: f.formatted,
      }))
    )
  }

  // Ventilation supprimée si annulation (la reventilation se fait via Config > Ventilation + Matching)
  if (moisComptable && upserted?.id) {
    if (finalStatus === 'cancelled' || finalStatus === 'not accepted') {
      await supabase.from('ventilation').delete().eq('reservation_id', upserted.id)
      console.log('Ventilation supprimée (annulation):', data.code)
    }
  }

  console.log('Upserted:', data.code, event)
  return 'upserted ' + data.code
}

// ============================================================
// PROPERTIES
// ============================================================
async function handleProperty(supabase: any, event: string, data: any): Promise<string> {
  const hospId = data.id || data.uuid
  if (!hospId) return 'no hospitable_id'

  if (event === 'property.created') {
    // V\u00e9rifier si le bien existe d\u00e9j\u00e0
    const { data: existing } = await supabase
      .from('bien')
      .select('id')
      .eq('hospitable_id', hospId)
      .single()

    if (!existing) {
      // Cr\u00e9er le bien avec les infos de base
      await supabase.from('bien').insert({
        hospitable_id:   hospId,
        hospitable_name: data.name,
        adresse:         data.address?.street,
        ville:           data.address?.city,
        listed:          data.listed ?? true,
        has_ae:          true,
        agence:          'dcb',
        gestion_loyer:   true,
        derniere_sync:   new Date().toISOString(),
      })
      console.log('Bien created:', hospId, data.name)
      return 'bien created: ' + data.name
    }
    return 'bien already exists'
  }

  if (event === 'property.updated' || event === 'property.modified') {
    await supabase.from('bien').update({
      hospitable_name: data.name,
      adresse:         data.address?.street,
      ville:           data.address?.city,
      listed:          data.listed ?? true,
      derniere_sync:   new Date().toISOString(),
    }).eq('hospitable_id', hospId)
    return 'bien updated: ' + hospId
  }

  if (event === 'property.deleted' || event === 'property.unlisted') {
    await supabase.from('bien').update({ listed: false }).eq('hospitable_id', hospId)
    return 'bien unlisted: ' + hospId
  }

  return 'property event: ' + event
}

// ============================================================
// MESSAGES
// ============================================================
async function handleMessage(supabase: any, event: string, data: any): Promise<string> {
  // Tracer les messages voyageur dans webhook_log suffit pour l'instant
  // Le payload contient : conversation_id, reservation_id, body, sender_type
  const resaId   = data.reservation_id || data.reservation?.id
  const convId   = data.conversation_id
  const body     = data.body || data.message || data.content || ''
  const senderType = data.sender_type || data.from || 'unknown'

  // Mettre à jour synced_at de la résa si on a un reservation_id
  if (resaId) {
    const { data: resa } = await supabase
      .from('reservation')
      .select('id, hospitable_id')
      .eq('hospitable_id', resaId)
      .single()

    if (resa) {
      console.log('Message re\u00e7u pour r\u00e9sa:', resa.id, senderType, body.substring(0, 50))
    }
  }

  return `message ${event} conv:${convId || 'n/a'}`
}

// ============================================================
// REVIEWS
// ============================================================
async function handleReview(supabase: any, event: string, data: any): Promise<string> {
  const resaHospId = data.reservation_id || data.reservation?.id
  if (!resaHospId) return 'no reservation_id'

  const rating   = data.rating || data.overall_rating || null
  const comment  = data.comment || data.review || data.body || null
  const reviewer = data.reviewer_name || data.guest?.name || null
  const submittedAt = data.submitted_at || data.created_at || null

  console.log('Review reçue:', resaHospId, 'note:', rating, reviewer)

  // Résoudre reservation_id interne depuis hospitable_id
  const { data: resa } = await supabase
    .from('reservation')
    .select('id')
    .eq('hospitable_id', resaHospId)
    .maybeSingle()

  const { error } = await supabase.from('reservation_review').upsert({
    reservation_id:              resa?.id || null,
    hospitable_reservation_id:   resaHospId,
    reviewer_name:               reviewer,
    rating,
    comment,
    submitted_at:                submittedAt,
  }, { onConflict: 'hospitable_reservation_id' })

  if (error) throw new Error('INSERT reservation_review failed: ' + error.message)

  // Envoi SMS de remerciement si avis 5 étoiles
  if (rating >= 5) {
    await sendReviewSMS(supabase, resaHospId, data, rating).catch((err: any) =>
      console.error('sendReviewSMS error (non-fatal):', err?.message)
    )
  }

  return `review ${event} resa:${resaHospId} note:${rating}`
}

// ============================================================
// SMS — remerciement avis 5 étoiles
// ============================================================
async function sendReviewSMS(supabase: any, resaHospId: string, data: any, rating: number): Promise<void> {
  const twilioSid   = Deno.env.get('TWILIO_ACCOUNT_SID')
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioFrom  = Deno.env.get('TWILIO_FROM_NUMBER')
  const googleUrl   = Deno.env.get('GOOGLE_REVIEW_URL')

  if (!twilioSid || !twilioToken || !twilioFrom || !googleUrl) {
    console.log('SMS skipped: Twilio secrets not configured')
    return
  }

  // Tenter d'abord le payload review, puis fallback sur la table reservation
  let guestPhone   = data.guest?.phone || data.guest?.phone_number || null
  let guestCountry = data.guest?.country || data.guest?.nationality || null
  let guestFirst   = data.guest?.first_name
    || (typeof data.reviewer_name === 'string' ? data.reviewer_name.split(' ')[0] : null)
    || null
  const propertyName = data.property?.name || data.listing?.name || 'notre villa'

  if (!guestPhone || !guestFirst || !guestCountry) {
    // Fallback : lire depuis reservation (stocké au moment du webhook de réservation)
    const { data: resaRow } = await supabase
      .from('reservation')
      .select('guest_phone, guest_country, guest_name')
      .eq('hospitable_id', resaHospId)
      .maybeSingle()
    if (resaRow) {
      if (!guestPhone)   guestPhone   = resaRow.guest_phone   || null
      if (!guestCountry) guestCountry = resaRow.guest_country || null
      if (!guestFirst && resaRow.guest_name) {
        guestFirst = resaRow.guest_name.split(' ')[0]
      }
    }
  }

  guestFirst = guestFirst || 'cher client'

  if (!guestPhone) {
    console.log('SMS skipped: no guest phone for', resaHospId)
    await supabase.from('sms_logs').insert({
      hospitable_reservation_id: resaHospId,
      guest_name:    data.reviewer_name || null,
      guest_phone:   null,
      language:      'FR',
      rating,
      sms_body:      null,
      status:        'no_phone',
      error_message: 'No guest phone in webhook payload or reservation table',
    })
    return
  }

  const lang    = detectSmsLang(guestCountry, guestPhone)
  const comment = data.comment || data.review || data.body || null
  const body    = await generateSmsBody(guestFirst, propertyName, lang, googleUrl, comment)

  let status        = 'error'
  let twilioSidOut  = null
  let errorMessage  = null

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: twilioFrom, To: guestPhone, Body: body }).toString(),
      }
    )
    const json = await res.json()
    if (res.ok) {
      status       = 'sent'
      twilioSidOut = json.sid || null
      console.log('Review SMS sent:', guestPhone, json.sid)
    } else {
      errorMessage = JSON.stringify(json)
      console.error('Twilio error:', errorMessage)
    }
  } catch (err: any) {
    errorMessage = err?.message || String(err)
    console.error('SMS fetch error:', errorMessage)
  }

  await supabase.from('sms_logs').insert({
    hospitable_reservation_id: resaHospId,
    guest_name:    data.reviewer_name || null,
    guest_phone:   guestPhone,
    language:      lang,
    rating,
    sms_body:      body,
    status,
    twilio_sid:    twilioSidOut,
    error_message: errorMessage,
  })
}

function detectSmsLang(country: string | null, phone: string | null = null): string {
  // 1. Indicatif téléphonique — le plus fiable
  if (phone) {
    const p = phone.replace(/\s/g, '')
    if (/^\+33/.test(p) || /^\+32/.test(p) || /^\+41/.test(p) || /^\+352/.test(p)) return 'FR'
    if (/^\+34/.test(p) || /^\+52/.test(p) || /^\+54/.test(p) || /^\+57/.test(p) || /^\+56/.test(p)) return 'ES'
    if (/^\+1/.test(p)  || /^\+44/.test(p) || /^\+61/.test(p) || /^\+64/.test(p) || /^\+353/.test(p)) return 'EN'
    if (/^\+/.test(p)) return 'EN'
  }
  // 2. Pays (fallback)
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
- Se termine par "— Destination Côte Basque" (quelle que soit la langue)
- N'inclut PAS le lien Google (il sera ajouté automatiquement)
- Ne commence PAS par "Bonjour ${firstName}" (déjà connu)

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
        if (text) {
          return `${firstName}, ${text}\n${googleUrl}\nSTOP pour se désabonner.`
        }
      }
    } catch (err: any) {
      console.error('Claude API error, fallback to template:', err?.message)
    }
  }

  // Fallback template statique
  const templates: Record<string, string> = {
    FR: `Bonjour ${firstName} ! Merci pour votre avis 5⭐ sur ${property}. Votre retour compte beaucoup pour nous ! Partager aussi sur Google : ${googleUrl} — Destination Côte Basque. Rép. STOP pour se désabonner.`,
    EN: `Hello ${firstName}! Thank you for your 5-star review of ${property}. Your feedback means a lot! Share on Google too: ${googleUrl} — Destination Côte Basque. Reply STOP to unsubscribe.`,
    ES: `¡Hola ${firstName}! Gracias por tu reseña 5⭐ de ${property}. ¡Tu opinión nos importa! Comparte en Google: ${googleUrl} — Destination Côte Basque. STOP para darse de baja.`,
  }
  return templates[lang] ?? templates['FR']
}
