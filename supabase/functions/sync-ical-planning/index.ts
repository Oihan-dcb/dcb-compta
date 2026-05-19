/**
 * sync-ical-planning
 *
 * Fetch les feeds iCal de tous les biens configurés (bien.ical_url IS NOT NULL)
 * et upsert les VEVENT dans planning_events.
 *
 * Appelé toutes les 5 min par pg_cron (migration 155).
 * PowerHouse et le portail owner lisent depuis planning_events.
 *
 * Avantages vs re-fetch iCal côté client :
 *  - Resas visibles avant ventilation mensuelle
 *  - Croisement ménages ↔ resas via planning_events.date_debut + bien_id
 *  - Portail owner à jour sans auth Hospitable
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseIcal, parseIcalDate, detecterSource } from '../_shared/ical-parser.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

Deno.serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Charger tous les biens avec iCal URL
  const { data: biens, error: biensErr } = await sb
    .from('bien')
    .select('id, hospitable_name, code, ical_url')
    .not('ical_url', 'is', null)

  if (biensErr || !biens?.length) {
    console.warn('Aucun bien avec ical_url configuré')
    return new Response(JSON.stringify({ ok: true, biens: 0, message: 'Aucun bien avec ical_url' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log(`sync-ical-planning — ${biens.length} bien(s) à traiter`)

  const results: Array<{ bien: string; upserted: number; cancelled: number; error?: string }> = []

  for (const bien of biens) {
    try {
      const result = await syncBienIcal(sb, bien)
      results.push({ bien: bien.code || bien.hospitable_name, ...result })
      console.log(`${bien.code}: +${result.upserted} upserted, ${result.cancelled} cancelled`)
    } catch (err: any) {
      console.error(`Erreur ${bien.code}:`, err.message)
      results.push({ bien: bien.code || bien.hospitable_name, upserted: 0, cancelled: 0, error: err.message })
    }
    // Petit délai pour éviter de saturer les APIs externes
    await new Promise(r => setTimeout(r, 200))
  }

  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0)
  const totalCancelled = results.reduce((s, r) => s + r.cancelled, 0)

  return new Response(JSON.stringify({
    ok: true,
    biens: biens.length,
    total_upserted: totalUpserted,
    total_cancelled: totalCancelled,
    synced_at: new Date().toISOString(),
    results,
  }), { headers: { 'Content-Type': 'application/json' } })
})

async function syncBienIcal(
  sb: ReturnType<typeof createClient>,
  bien: { id: string; hospitable_name: string; code: string | null; ical_url: string }
): Promise<{ upserted: number; cancelled: number }> {
  // Fetch feed
  const icalUrl = bien.ical_url.replace(/^webcal:/, 'https:')
  const resp = await fetch(icalUrl, { signal: AbortSignal.timeout(10_000) })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching iCal`)

  const icalText = await resp.text()
  const events = parseIcal(icalText)

  let upserted = 0
  let cancelled = 0

  for (const evt of events) {
    // UID obligatoire pour upsert idempotent
    if (!evt.uid || !evt.dtstart) continue

    const dateDebut = parseIcalDate(evt.dtstart)
    const dateFin   = parseIcalDate(evt.dtend)
    if (!dateDebut) continue

    const isCancelled = evt.status?.toUpperCase() === 'CANCELLED'
    const source = detecterSource(evt.summary, icalUrl)

    const row = {
      bien_id:      bien.id,
      uid_ical:     evt.uid,
      source,
      date_debut:   dateDebut.toISOString().substring(0, 10),
      date_fin:     dateFin ? dateFin.toISOString().substring(0, 10) : null,
      titre:        evt.summary,
      statut:       isCancelled ? 'cancelled' : 'confirmed',
      derniere_sync: new Date().toISOString(),
    }

    const { error } = await sb
      .from('planning_events')
      .upsert(row, { onConflict: 'bien_id,uid_ical' })

    if (error) {
      console.warn(`upsert error ${bien.code} ${evt.uid}:`, error.message)
      continue
    }

    if (isCancelled) cancelled++
    else upserted++
  }

  return { upserted, cancelled }
}
