/**
 * sync-ical-planning  (v2 — Hospitable Calendar API)
 *
 * Remplace l'approche iCal manuelle.
 * Appelle GET /v2/properties/{hospitable_id}/calendar pour chaque bien,
 * groupe les jours indisponibles en spans, et upsert dans property_calendar.
 * Depuis le 10/10/2026 (migration 398) : un seul RPC transactionnel par bien (diff, ids stables)
 * + les prix / séjour minimum / fermetures du jour dans calendrier_jour.
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
// Hospitable ralentit parfois (délais dépassés, 502 du 20/10/2026 sur 14 biens) : un appel lent ou en
// erreur passagère est retenté au lieu d'abandonner le bien jusqu'au passage suivant.
const TIMEOUT_MS   = 20_000
const TENTATIVES   = 3            // 1 appel + 2 reprises (délai dépassé, 429, 5xx)
const BUDGET_MS    = 240_000      // au-delà, les biens restants attendent le passage suivant (toutes les 5 min)

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

  const results: Array<{ bien: string; upserted: number; deleted: number; error?: string; [k: string]: unknown }> = []

  // Les biens les moins fraîchement synchronisés passent en premier : si Hospitable ralentit et que le
  // budget de temps du passage est atteint, ce sont toujours les plus anciens qui sont repris ensuite.
  const { data: etats } = await sb.from('calendrier_sync_bien_etat').select('bien_id, synchro_le, ok')
  const fraicheur = new Map((etats || []).map((e: any) => [e.bien_id, e.ok ? Date.parse(e.synchro_le) : 0]))
  biens.sort((a, b) => (fraicheur.get(a.id) ?? 0) - (fraicheur.get(b.id) ?? 0))

  for (const bien of biens) {
    if (Date.now() - now.getTime() > BUDGET_MS) {
      results.push({ bien: bien.code || bien.hospitable_name, upserted: 0, deleted: 0, reporte: true })
      continue
    }
    try {
      const result = await syncBienCalendar(sb, bien, startDate, endDate)
      results.push({ bien: bien.code || bien.hospitable_name, ...result })
      console.log(`${bien.code}: ${result.upserted} spans, ${result.deleted} supprimés`)
    } catch (err: any) {
      console.error(`Erreur ${bien.code}:`, err.message)
      // Les données du bien restent en place (rien n'est vidé) ; l'erreur se lit dans le Calendrier.
      await sb.rpc('calendrier_sync_bien_erreur', { p_bien_id: bien.id, p_erreur: String(err.message || err) }).then(() => {}, () => {})
      results.push({ bien: bien.code || bien.hospitable_name, upserted: 0, deleted: 0, error: err.message })
    }
    // Petit délai pour ne pas burst l'API
    await new Promise(r => setTimeout(r, 100))
  }

  // Tarifs des biens qui ne sont plus synchronisés (délistés, hospitable_id retiré) : retirés, pour
  // qu'aucun prix figé ne s'affiche. Leurs spans property_calendar, eux, restent (historique, iCal).
  const ids = biens.map(b => b.id)
  await sb.from('calendrier_jour').delete().not('bien_id', 'in', `(${ids.join(',')})`).then(() => {}, () => {})

  return new Response(JSON.stringify({
    ok: true,
    biens: biens.length,
    window: { start: startDate, end: endDate },
    total_upserted: results.reduce((s, r) => s + r.upserted, 0),
    total_deleted:  results.reduce((s, r) => s + r.deleted, 0),
    total_jours_modifies: results.reduce((s, r) => s + Number(r.jours_modifies || 0), 0),
    duree_ms: Date.now() - now.getTime(),
    synced_at: new Date().toISOString(),
    results,
  }), { headers: { 'Content-Type': 'application/json' } })
})

async function syncBienCalendar(
  sb: ReturnType<typeof createClient>,
  bien: { id: string; hospitable_id: string; code: string | null; hospitable_name: string },
  startDate: string,
  endDate: string
): Promise<{ upserted: number; deleted: number; inseres: number; modifies: number; jours_modifies: number }> {

  // 2. Appel API Hospitable v2/calendar
  const url = `${HOSP_BASE}/properties/${bien.hospitable_id}/calendar?start_date=${startDate}&end_date=${endDate}`
  const json = await appelHospitable(url)
  const days: any[] = json.data?.days || []
  // Réponse sans aucun jour = information INCONNUE, pas « calendrier entièrement libre » : on ne touche
  // à rien (sinon le diff supprimerait tous les spans du bien).
  if (!days.length) throw new Error('Hospitable : réponse calendrier sans jours (rien modifié)')

  // 3. Grouper les jours indisponibles en spans
  const spans = groupUnavailableDays(days)

  // 4. Jours (prix, séjour minimum, fermetures) — même réponse, aucun appel Hospitable en plus.
  //    Stockés dans calendrier_jour pour la grille du Calendrier PowerHouse (migration 398), au lieu
  //    que chaque navigateur ouvert relise Hospitable toutes les 5 min (api/dispo-pricing.js).
  const jours = days.filter(d => d?.date).map(d => ({
    jour:   String(d.date).slice(0, 10),
    dispo:  d.status?.available === true,
    prix:   typeof d.price?.amount === 'number' ? Math.round(d.price.amount) : null,
    devise: d.price?.currency || null,
    min:    typeof d.min_stay === 'number' ? d.min_stay : null,
    ci:     d.closed_for_checkin === true,
    co:     d.closed_for_checkout === true,
    note:   d.note || null,
    raison: d.status?.reason || null,
  }))

  // 5. Une seule transaction par bien (RPC calendrier_sync_bien, migration 398) : upsert sur
  //    (bien_id, uid_cal) qui n'écrit que ce qui a changé, suppression des seuls spans disparus.
  //
  //    AVANT (jusqu'au 10/10/2026) : DELETE de tous les spans de la fenêtre puis INSERT, sans
  //    transaction — 9 M insertions cumulées, ids qui changeaient toutes les 5 min, et un bien
  //    VIDE pour tout lecteur tombant entre les deux requêtes (ou pendant 5 min si l'INSERT
  //    échouait). La fenêtre de suppression reste celle du fix du 23/08/2026 (recouvrement
  //    d'intervalles [startDate, endDate)) : rien d'authentiquement passé n'est touché.
  const { data, error } = await sb.rpc('calendrier_sync_bien', {
    p_bien_id: bien.id,
    p_debut:   startDate,
    p_fin:     endDate,
    p_spans:   spans,
    p_jours:   jours,
  })
  if (error) throw new Error(`RPC calendrier_sync_bien: ${error.message}`)

  return {
    upserted: (data?.inseres ?? 0) + (data?.modifies ?? 0),
    deleted:  data?.supprimes ?? 0,
    inseres:  data?.inseres ?? 0,
    modifies: data?.modifies ?? 0,
    jours_modifies: data?.jours_modifies ?? 0,
  }
}

// Appel GET avec reprises. Les messages d'erreur sont lisibles (ils s'affichent dans le Calendrier) :
// jamais de page HTML brute de la passerelle.
async function appelHospitable(url: string): Promise<any> {
  let derniere = ''
  for (let i = 1; i <= TENTATIVES; i++) {
    let reprendre = false
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${HOSP_TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (resp.ok) return await resp.json()
      const corps = (await resp.text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      reprendre = resp.status === 429 || resp.status >= 500
      derniere = resp.status >= 500 ? `Hospitable indisponible (erreur ${resp.status})`
        : resp.status === 429 ? 'Hospitable : trop de requêtes (429)'
        : `Hospitable a refusé la lecture du calendrier (erreur ${resp.status}${corps && !/^<|html/i.test(corps) ? ' : ' + corps.slice(0, 120) : ''})`
    } catch (err: any) {
      const delai = err?.name === 'TimeoutError' || /timed out/i.test(String(err?.message))
      derniere = delai ? `Hospitable n'a pas répondu en ${TIMEOUT_MS / 1000} s` : `Hospitable injoignable (${String(err?.message || err).slice(0, 120)})`
      reprendre = true
    }
    if (!reprendre || i === TENTATIVES) break
    await new Promise(r => setTimeout(r, i * 3000))
  }
  throw new Error(derniere + (TENTATIVES > 1 ? ` après ${TENTATIVES} essais` : ''))
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
      // Fenêtre de disponibilité Hospitable (réglage availability_window : dates fermées par défaut, ouvertes à la main) :
      // ce n'est pas un blocage du propriétaire ni de l'équipe → titre sentinelle AVAILABILITY_WINDOW, span séparé
      // (portail owner « Pas encore ouvert à la location », PowerHouse « fermé par défaut ») — 20/10/2026.
      const fenetre = day.status?.source_type === 'AVAILABILITY_WINDOW' && !day.note
      const titre  = fenetre ? 'AVAILABILITY_WINDOW' : (day.note || day.status?.reason || null)

      if (!current) {
        // Début d'un nouveau span
        current = { date_debut: day.date, date_fin: day.date, source, titre }
      } else if (current.source === source && (current.titre === 'AVAILABILITY_WINDOW') === fenetre) {
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
