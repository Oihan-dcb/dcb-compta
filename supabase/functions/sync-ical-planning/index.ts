/**
 * sync-ical-planning  (v2 — Hospitable Calendar API)
 *
 * Remplace l'approche iCal manuelle.
 * Appelle GET /v2/properties/{hospitable_id}/calendar pour chaque bien,
 * groupe les jours indisponibles en spans, et upsert dans property_calendar.
 *
 * Avantages vs iCal :
 *  - Aucune URL à configurer manuellement
 *  - Bearer token déjà disponible (HOSPITABLE_TOKEN)
 *  - Couvre toutes les plateformes + bloquages propriétaire
 *  - Rate limit : 1000 req/min → ~50 biens = 50 req/run, largement OK
 *
 * Appelé toutes les 5 min par pg_cron (migration 155).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const HOSP_TOKEN    = Deno.env.get('HOSPITABLE_TOKEN')!
const HOSP_BASE     = 'https://public.api.hospitable.com/v2'

// Fenêtre de sync : J-14 → J+365
const DAYS_BACK    = 14
const DAYS_FORWARD = 365

Deno.serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Charger tous les biens listés avec hospitable_id
  const { data: biens, error: biensErr } = await sb
    .from('bien')
    .select('id, hospitable_id, code, hospitable_name')
    .not('hospitable_id', 'is', null)
    .eq('listed', true)

  if (biensErr || !biens?.length) {
    console.warn('Aucun bien avec hospitable_id')
    return new Response(JSON.stringify({ ok: true, biens: 0 }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log(`sync-ical-planning (v2 calendar) — ${biens.length} bien(s)`)

  const now       = new Date()
  const startDate = dateOffset(now, -DAYS_BACK)
  const endDate   = dateOffset(now, DAYS_FORWARD)

  const results: Array<{ bien: string; upserted: number; deleted: number; error?: string }> = []

  for (const bien of biens) {
    try {
      const result = await syncBienCalendar(sb, bien, startDate, endDate)
      results.push({ bien: bien.code || bien.hospitable_name, ...result })
      console.log(`${bien.code}: ${result.upserted} spans, ${result.deleted} supprimés`)
    } catch (err: any) {
      console.error(`Erreur ${bien.code}:`, err.message)
      results.push({ bien: bien.code || bien.hospitable_name, upserted: 0, deleted: 0, error: err.message })
    }
    // Petit délai pour ne pas burst l'API
    await new Promise(r => setTimeout(r, 100))
  }

  return new Response(JSON.stringify({
    ok: true,
    biens: biens.length,
    window: { start: startDate, end: endDate },
    total_upserted: results.reduce((s, r) => s + r.upserted, 0),
    synced_at: new Date().toISOString(),
    results,
  }), { headers: { 'Content-Type': 'application/json' } })
})

async function syncBienCalendar(
  sb: ReturnType<typeof createClient>,
  bien: { id: string; hospitable_id: string; code: string | null; hospitable_name: string },
  startDate: string,
  endDate: string
): Promise<{ upserted: number; deleted: number }> {

  // 2. Appel API Hospitable v2/calendar
  const url = `${HOSP_BASE}/properties/${bien.hospitable_id}/calendar?start_date=${startDate}&end_date=${endDate}`
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${HOSP_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Hospitable API ${resp.status}: ${body.substring(0, 200)}`)
  }

  const json = await resp.json()
  const days: any[] = json.data?.days || []

  // 3. Grouper les jours indisponibles en spans
  const spans = groupUnavailableDays(days)

  // 4. Supprimer les anciennes entrées dans la fenêtre (remplacer proprement)
  const { count: deleted } = await sb
    .from('property_calendar')
    .delete({ count: 'exact' })
    .eq('bien_id', bien.id)
    .gte('date_debut', startDate)
    .lte('date_debut', endDate)

  // 5. Insérer les nouveaux spans
  if (spans.length === 0) return { upserted: 0, deleted: deleted ?? 0 }

  const rows = spans.map(span => ({
    bien_id:       bien.id,
    uid_cal:      `${bien.id}:${span.date_debut}`,
    source:        span.source,
    date_debut:    span.date_debut,
    date_fin:      span.date_fin,
    titre:         span.titre,
    statut:        'confirmed',
    derniere_sync: new Date().toISOString(),
  }))

  const { error } = await sb.from('property_calendar').insert(rows)
  if (error) throw new Error(`Insert error: ${error.message}`)

  return { upserted: spans.length, deleted: deleted ?? 0 }
}

// ─── Segmentation ──────────────────────────────────────────────────────────────

interface Span {
  date_debut: string
  date_fin:   string  // jour suivant le dernier jour occupé (DTEND exclusif)
  source:     string
  titre:      string | null
}

function groupUnavailableDays(days: any[]): Span[] {
  const spans: Span[] = []
  let current: Partial<Span> | null = null

  for (const day of days) {
    if (!day.status?.available) {
      const source = detectSource(day)
      const titre  = day.note || day.status?.reason || null

      if (!current) {
        // Début d'un nouveau span
        current = { date_debut: day.date, date_fin: day.date, source, titre }
      } else if (current.source === source) {
        // Même type → prolonger le span
        current.date_fin = day.date
      } else {
        // Changement de type → fermer l'ancien, ouvrir un nouveau
        spans.push(closeSpan(current))
        current = { date_debut: day.date, date_fin: day.date, source, titre }
      }
    } else {
      if (current) {
        spans.push(closeSpan(current))
        current = null
      }
    }
  }
  if (current) spans.push(closeSpan(current))

  return spans
}

function closeSpan(s: Partial<Span>): Span {
  // date_fin = lendemain du dernier jour occupé (fin exclusive)
  const d = new Date(s.date_fin! + 'T12:00:00Z')
  d.setDate(d.getDate() + 1)
  return {
    date_debut: s.date_debut!,
    date_fin:   d.toISOString().substring(0, 10),
    source:     s.source!,
    titre:      s.titre ?? null,
  }
}

function detectSource(day: any): string {
  const src = day.status?.source?.toLowerCase() || ''
  if (src.includes('airbnb')) return 'airbnb'
  if (src.includes('booking')) return 'booking'
  if (src.includes('vrbo') || src.includes('abritel')) return 'abritel'
  const reason = day.status?.reason?.toUpperCase() || ''
  if (reason === 'BLOCKED' || day.status?.source_type === 'PLATFORM') return 'blocked'
  return 'direct'
}

// ─── Helpers date ──────────────────────────────────────────────────────────────

function dateOffset(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().substring(0, 10)
}
