import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    const { ae_id, mois } = await req.json()
    if (!ae_id || !mois) return new Response(JSON.stringify({ error: 'ae_id et mois requis' }), { status: 400 })

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    // 1. Lire la fiche AE
    const { data: ae, error: aeErr } = await sb.from('auto_entrepreneur').select('id, nom, prenom, ical_url').eq('id', ae_id).single()
    if (aeErr || !ae) return new Response(JSON.stringify({ error: 'AE introuvable' }), { status: 404 })
    if (!ae.ical_url) return new Response(JSON.stringify({ error: 'URL iCal non configurée pour cet AE', created: 0 }), { status: 200 })

    // 2. Lire tous les biens avec ical_code
    const { data: biens } = await sb.from('bien').select('id, ical_code, hospitable_name').not('ical_code', 'is', null)
    const bienMap = (biens || []).reduce((m, b) => { m[b.ical_code] = b; return m }, {})

    // 3. Fetch iCal (webcal → https)
    const icalUrl = ae.ical_url.replace(/^webcal:/, 'https:')
    const icalResp = await fetch(icalUrl)
    if (!icalResp.ok) return new Response(JSON.stringify({ error: 'Erreur fetch iCal: ' + icalResp.status }), { status: 500 })
    const icalText = await icalResp.text()

    // 4. Parser les VEVENT
    const events = parseIcal(icalText)

    // 5. Filtrer par mois et type Cleaning/Check-in
    const [annee, moisNum] = mois.split('-').map(Number)
    const eventsDuMois = events.filter(e => {
      if (!e.dtstart) return false
      const d = parseIcalDate(e.dtstart)
      return d && d.getFullYear() === annee && (d.getMonth() + 1) === moisNum
    })

    // 6. Matcher avec les biens et upsert
    let created = 0, updated = 0, skipped = 0
    for (const evt of eventsDuMois) {
      const titre = evt.summary || ''
      // Extraire le ical_code depuis le titre: "Cleaning (CODE1234)" → "CODE1234" → match avec CODE
      const match = titre.match(/\(([^)]+)\)/)
      if (!match) { skipped++; continue }
      const codeInTitle = match[1] // ex: "ChambreIbañetaMa0145"

      // Chercher le bien dont ical_code est un préfixe du code extrait
      let bien = null
      for (const [code, b] of Object.entries(bienMap)) {
        if (codeInTitle.startsWith(code)) { bien = b; break }
      }

      const dateMission = parseIcalDate(evt.dtstart)
      if (!dateMission) { skipped++; continue }
      const dateStr = dateMission.toISOString().substring(0, 10)

      const isCancelled = evt.status?.toUpperCase() === 'CANCELLED'

      // Événement annulé : marquer cancelled si la mission existe déjà
      if (isCancelled) {
        if (evt.uid) {
          await sb.from('mission_menage')
            .update({ statut: 'cancelled' })
            .eq('ical_uid', evt.uid)
        }
        skipped++
        continue
      }

      const row = {
        ae_id: ae.id,
        bien_id: bien?.id || null,
        date_mission: dateStr,
        titre_ical: titre,
        ical_uid: evt.uid || null,
        mois,
        statut: 'planifie',
        type_mission: 'checkout',
        imputation: 'ventilation_dcb',
        duree_prevue: computeDureeHeures(evt.dtstart, evt.dtend),
      }

      const { error: upsertErr } = await sb.from('mission_menage')
        .upsert(row, { onConflict: 'ical_uid', ignoreDuplicates: false })

      if (upsertErr) { skipped++; continue }
      created++

      // Lier reservation_id + ventilation_auto_id pour les Cleaning/Check-out
      // (Check-in et Maintenance n'ont pas de ventilation AUTO associée)
      const titreLC = titre.toLowerCase()
      const isCleaningOrCheckout = titreLC.startsWith('cleaning') || titreLC.startsWith('check-out') || titreLC.startsWith('checkout')
      if (bien && evt.uid && isCleaningOrCheckout) {
        await lierMissionResa(sb, { ical_uid: evt.uid, bien_id: bien.id, date_mission: dateStr, mois })
      }
    }

    // Réconciliation : missions en DB non présentes dans le feed → cancelled
    const feedUids = new Set(eventsDuMois.map(e => e.uid).filter(Boolean))
    const { data: dbMissions } = await sb.from('mission_menage')
      .select('id, ical_uid')
      .eq('ae_id', ae.id)
      .eq('mois', mois)
      .neq('statut', 'cancelled')
      .not('ical_uid', 'is', null)
    for (const m of dbMissions || []) {
      if (!feedUids.has(m.ical_uid)) {
        await sb.from('mission_menage').update({ statut: 'cancelled' }).eq('id', m.id)
      }
    }

    return new Response(JSON.stringify({ created, updated, skipped, total: eventsDuMois.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})

// ─── Liaison mission ↔ réservation ↔ ventilation AUTO ─────────────────────
// Cherche la résa accepted dont departure_date = date_mission ou date_mission+1
// (ménage la veille du départ), puis remonte le ventilation_auto_id.
async function lierMissionResa(
  sb: ReturnType<typeof createClient>,
  { ical_uid, bien_id, date_mission, mois }: { ical_uid: string; bien_id: string; date_mission: string; mois: string }
) {
  // Priorité : date exacte → lendemain (ménage veille)
  for (const offset of [0, 1]) {
    const d = new Date(date_mission + 'T12:00:00Z')
    d.setDate(d.getDate() + offset)
    const depDate = d.toISOString().substring(0, 10)

    const { data: resa } = await sb.from('reservation')
      .select('id')
      .eq('bien_id', bien_id)
      .eq('final_status', 'accepted')
      .eq('departure_date', depDate)
      .maybeSingle()

    if (!resa) continue

    const { data: ventil } = await sb.from('ventilation')
      .select('id')
      .eq('reservation_id', resa.id)
      .eq('code', 'AUTO')
      .maybeSingle()

    await sb.from('mission_menage')
      .update({ reservation_id: resa.id, ventilation_auto_id: ventil?.id ?? null })
      .eq('ical_uid', ical_uid)
      .is('reservation_id', null)  // ne pas écraser un lien déjà établi

    break
  }
}

function parseIcal(text) {
  const events = []
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n /g, '').split('\n')
  let current = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {} }
    else if (line === 'END:VEVENT') { if (current) events.push(current); current = null }
    else if (current) {
      const col = line.indexOf(':')
      if (col < 0) continue
      const key = line.substring(0, col).toLowerCase().replace(/;[^:]+/, '')
      const val = line.substring(col + 1)
      if (key === 'dtstart') current.dtstart = val
      else if (key === 'dtend') current.dtend = val
      else if (key === 'summary') current.summary = val
      else if (key === 'uid') current.uid = val
      else if (key === 'status') current.status = val
    }
  }
  return events
}

function parseDatetime(s: string): Date | null {
  if (!s) return null
  const clean = s.replace(/[^0-9T]/g, '')
  if (/^\d{8}$/.test(clean)) {
    return new Date(parseInt(clean.substring(0,4)), parseInt(clean.substring(4,6))-1, parseInt(clean.substring(6,8)))
  }
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]))
  return null
}

function computeDureeHeures(dtstart: string, dtend: string): number | null {
  const start = parseDatetime(dtstart)
  const end = parseDatetime(dtend)
  if (!start || !end) return null
  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return null
  return Math.round((diffMs / 3600000) * 100) / 100
}

function parseIcalDate(s) {
  // Format: 20260315 ou 20260315T143000Z
  if (!s) return null
  const clean = s.replace(/T.*/, '')
  if (clean.length !== 8) return null
  return new Date(
    parseInt(clean.substring(0, 4)),
    parseInt(clean.substring(4, 6)) - 1,
    parseInt(clean.substring(6, 8))
  )
}
