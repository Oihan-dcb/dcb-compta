import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SERVICE_ROLE_KEY')!
const HOSP_TOKEN   = Deno.env.get('HOSPITABLE_TOKEN')!
const BASE_URL     = 'https://public.api.hospitable.com/v2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function apiFetch(path: string, params: Record<string, any> = {}) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(`${k}[]`, x))
    else if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  })
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${HOSP_TOKEN}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Hospitable ${res.status}: ${err.message || path}`)
  }
  return res.json()
}

async function fetchAll(path: string, params: Record<string, any> = {}) {
  let page = 1, all: any[] = []
  while (true) {
    const data = await apiFetch(path, { ...params, limit: 50, page })
    const items: any[] = data.data || []
    all = all.concat(items)
    const meta = data.meta || {}
    if (page >= (meta.last_page || 1) || items.length < 50) break
    page++
    await new Promise(r => setTimeout(r, 100))
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const body = await req.json().catch(() => ({}))
  const mois: string | undefined = body.mois  // optionnel, format YYYY-MM

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Récupérer configs agences (google_review_url + label)
  const { data: agenceConfigs } = await sb.from('agency_config').select('agence, google_review_url, label')
  const agenceMap: Record<string, { googleUrl: string | null, label: string }> = {}
  for (const cfg of (agenceConfigs || [])) {
    agenceMap[cfg.agence] = { googleUrl: cfg.google_review_url || null, label: cfg.label || cfg.agence.toUpperCase() }
  }
  // Fallback env var pour DCB
  const envGoogleUrl = Deno.env.get('GOOGLE_REVIEW_URL')
  if (envGoogleUrl && agenceMap['dcb']) agenceMap['dcb'].googleUrl = agenceMap['dcb'].googleUrl || envGoogleUrl

  // Récupérer tous nos biens avec leur hospitable_id + agence
  const { data: biens } = await sb
    .from('bien')
    .select('id, hospitable_id, hospitable_name, agence, zone')
    .not('hospitable_id', 'is', null)

  if (!biens?.length) return json({ ok: true, total: 0, synced: 0 })

  let total = 0, synced = 0, errors = 0, smsQueued = 0

  for (const bien of biens) {
    let reviews: any[]
    try {
      reviews = await fetchAll(`/properties/${bien.hospitable_id}/reviews`, { include: 'reservation' })
    } catch (e: any) {
      console.error(`Skipping ${bien.hospitable_name}: ${e.message}`)
      errors++
      continue
    }

    for (const review of reviews) {

      // Filtrer par mois si fourni
      if (mois) {
        const ts = review.reviewed_at || ''
        if (!ts.startsWith(mois)) continue
      }

      total++

      // review.reservation_id = ID Hospitable de la réservation (pour jointure)
      // review.id = ID du review lui-même (fallback si pas de reservation_id)
      const resaHospId = review.reservation_id || review.reservation?.id || review.id

      // Résoudre reservation_id interne depuis hospitable_id
      const { data: resaRow } = await sb
        .from('reservation')
        .select('id, guest_phone, guest_country, guest_name')
        .eq('hospitable_id', resaHospId)
        .maybeSingle()

      const row = {
        reservation_id:            resaRow?.id || null,
        bien_id:                   bien.id,
        hospitable_reservation_id: resaHospId,
        reviewer_name:             review.reviewer?.name || review.guest?.name || null,
        rating:                    review.public?.rating ?? null,
        comment:                   review.public?.review ?? null,
        submitted_at:              review.reviewed_at ?? null,
      }

      const { error } = await sb
        .from('reservation_review')
        .upsert(row, { onConflict: 'hospitable_reservation_id' })

      if (error) { console.error('upsert:', error.message); errors++; continue }
      synced++

      // Jointure par proximité de date pour trouver la réservation (fallback si pas de match par hospitable_id)
      let matchedResa: any = null
      if (row.submitted_at) {
        const reviewedAt = new Date(row.submitted_at)
        const dateMin = new Date(reviewedAt.getTime() - 14 * 86400_000).toISOString().slice(0, 10)
        const dateMax = new Date(reviewedAt.getTime() +  3 * 86400_000).toISOString().slice(0, 10)

        // Priorité aux réservations avec téléphone
        let { data: found } = await sb
          .from('reservation')
          .select('id, review_rating, guest_phone, guest_country, guest_name')
          .eq('bien_id', bien.id)
          .gte('departure_date', dateMin)
          .lte('departure_date', dateMax)
          .not('guest_phone', 'is', null)
          .order('departure_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        // Fallback sans filtre téléphone
        if (!found) {
          const { data: foundAny } = await sb
            .from('reservation')
            .select('id, review_rating, guest_phone, guest_country, guest_name')
            .eq('bien_id', bien.id)
            .gte('departure_date', dateMin)
            .lte('departure_date', dateMax)
            .order('departure_date', { ascending: false })
            .limit(1)
            .maybeSingle()
          found = foundAny || null
        }

        matchedResa = found || null

        if (matchedResa && matchedResa.review_rating === null && row.rating !== null) {
          await sb.from('reservation').update({ review_rating: row.rating }).eq('id', matchedResa.id)
          if (!row.reservation_id) {
            await sb.from('reservation_review')
              .update({ reservation_id: matchedResa.id })
              .eq('hospitable_reservation_id', row.hospitable_reservation_id)
          }
        }
      }

      // SMS 5 étoiles : priorité resaRow (match direct), fallback matchedResa (match par date)
      const bienAgence = bien.agence || 'dcb'
      const agenceCfg  = agenceMap[bienAgence] || agenceMap['dcb'] || { googleUrl: null, label: 'Destination Côte Basque' }
      const googleUrl  = agenceCfg.googleUrl

      if (row.rating !== null && row.rating >= 5 && googleUrl) {
        const resaForSms = resaRow || matchedResa
        const guestPhone   = resaForSms?.guest_phone   || null
        const guestCountry = resaForSms?.guest_country || null
        const guestName    = resaForSms?.guest_name    || row.reviewer_name || null

        // Dedup : déjà dans sms_queue ou sms_logs ?
        const [{ count: qCount }, { count: lCount }] = await Promise.all([
          sb.from('sms_queue').select('id', { count: 'exact', head: true })
            .eq('hospitable_reservation_id', resaHospId),
          sb.from('sms_logs').select('id', { count: 'exact', head: true })
            .eq('hospitable_reservation_id', resaHospId)
            .neq('status', 'no_phone'),
        ])

        if ((qCount || 0) === 0 && (lCount || 0) === 0) {
          if (guestPhone) {
            const sendAt = new Date(Date.now() + 28 * 60 * 1000).toISOString()
            const comment = review.public?.review || null
            const propertyZone = bien.zone || null
            const previewBody = googleUrl
              ? await generatePreviewBody(guestName, bien.hospitable_name, guestCountry, guestPhone, comment, googleUrl, agenceCfg.label, propertyZone).catch(() => null)
              : null
            const { error: qErr } = await sb.from('sms_queue').insert({
              hospitable_reservation_id: resaHospId,
              guest_name:    guestName,
              guest_phone:   guestPhone,
              guest_country: guestCountry,
              property_name: bien.hospitable_name,
              comment,
              rating:        row.rating,
              send_at:       sendAt,
              preview_body:  previewBody,
              agence:        bienAgence,
              agence_label:  agenceCfg.label,
              property_zone: propertyZone,
            })
            if (qErr) { console.error('sms_queue insert:', qErr.message) }
            else { smsQueued++; console.log('SMS queued (sync-reviews):', resaHospId, guestPhone) }
          } else {
            // Log no_phone pour ne pas retenter à chaque sync
            await sb.from('sms_logs').insert({
              hospitable_reservation_id: resaHospId,
              guest_name:    guestName,
              guest_phone:   null,
              language:      'FR',
              rating:        row.rating,
              status:        'no_phone',
              error_message: 'No guest phone in reservation table (sync-reviews)',
            }).catch(() => {})
          }
        }
      }

    }

    await new Promise(r => setTimeout(r, 100))  // pause entre propriétés
  }

  console.log(`sync-reviews: ${synced} ok, ${errors} errors / ${total} reviews, ${biens.length} properties, ${smsQueued} SMS queued`)
  return json({ ok: true, total, synced, errors, smsQueued, properties: biens.length })
})

// ─── Helpers SMS ─────────────────────────────────────────────

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
  guestPhone: string | null, comment: string | null, googleUrl: string,
  agenceLabel = 'Destination Côte Basque', propertyZone: string | null = null
): Promise<string> {
  const firstName = (guestName || 'cher client').split(' ')[0]
  const lang = detectSmsLang(guestCountry, guestPhone)
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const langLabel = lang === 'FR' ? 'français' : lang === 'EN' ? 'anglais' : 'espagnol'
  const zoneRule = propertyZone
    ? `- La zone géographique du bien est "${propertyZone}" — tu peux l'utiliser si pertinent`
    : `- Ne mentionne AUCUNE région géographique dans le texte`

  if (anthropicKey && comment) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{ role: 'user', content: `Tu es l'assistant de ${agenceLabel}. Un voyageur vient de laisser un avis 5⭐ sur Airbnb pour "${propertyName}". Son commentaire : "${comment}"\nRédige un SMS de remerciement en ${langLabel} (160-220 caractères). Règles STRICTES :\n- N'inclus AUCUNE URL, AUCUN lien, AUCUN placeholder dans le texte\n${zoneRule}\n- La signature est "— ${agenceLabel}"\n- Termine par cette phrase exacte selon la langue : FR: "Soutenez-nous sur Google →" / EN: "Support us on Google →" / ES: "Apóyanos en Google →"\n- Sans mention STOP\nRéponds uniquement avec le texte du SMS, le lien Google sera ajouté automatiquement après.` }],
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
    FR: `${firstName}, merci pour votre avis 5⭐ Airbnb sur ${propertyName} ! Votre retour nous touche beaucoup. Soutenez-nous sur Google → — ${agenceLabel}\n${googleUrl}`,
    EN: `${firstName}, thank you for your 5-star Airbnb review of ${propertyName}! Your feedback means so much to us. Support us on Google → — ${agenceLabel}\n${googleUrl}`,
    ES: `${firstName}, ¡gracias por tu reseña 5⭐ de Airbnb sobre ${propertyName}! Tu opinión nos llena de alegría. Apóyanos en Google → — ${agenceLabel}\n${googleUrl}`,
  }
  return t[lang] ?? t['FR']
}
