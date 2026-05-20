/**
 * Edge Function — sync-reservations-cron
 *
 * Synchronise toutes les réservations de l'année en cours depuis Hospitable.
 * Appel serveur direct (pas de proxy) via HOSPITABLE_TOKEN.
 * Déclenché par pg_cron chaque nuit à 2h UTC.
 *
 * Body accepté : { agence?: string, dry_run?: boolean, annee?: number }
 *   - agence  : défaut 'dcb'
 *   - dry_run : si true, calcule sans écrire en base
 *   - annee   : défaut année courante
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const HOSP_TOKEN   = Deno.env.get('HOSPITABLE_TOKEN') ?? ''
const BASE_URL     = 'https://public.api.hospitable.com/v2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Hospitable API ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, params: Record<string, any> = {}) {
  if (!HOSP_TOKEN) throw new Error('HOSPITABLE_TOKEN non configuré')
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(vi => url.searchParams.append(`${k}[]`, vi))
    else if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  })
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${HOSP_TOKEN}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Hospitable ${res.status}: ${(err as any).message || url.pathname}`)
  }
  return res.json()
}

async function fetchAll(path: string, params: Record<string, any> = {}, pageSize = 50) {
  let page = 1
  const all: any[] = []
  while (true) {
    const data = await apiFetch(path, { ...params, per_page: pageSize, page })
    const items: any[] = data.data || []
    all.push(...items)
    const meta = data.meta || {}
    if (page >= (meta.last_page || 1) || all.length >= (meta.total || items.length)) break
    page++
  }
  return all
}

// ── Parse réservation ──────────────────────────────────────────────────────────

function parseReservation(resa: any, bien: any, fallbackMois: string) {
  const fin = resa.financials?.host || {}

  const hostServiceFee = (fin.host_fees || []).find((f: any) =>
    f.label?.toLowerCase().includes('host service') ||
    f.label?.toLowerCase().includes('service fee')
  )

  const taxesTotal = (fin.taxes || []).reduce((s: number, t: any) => s + (t.amount || 0), 0)

  const moisComptable = resa.arrival_date?.substring(0, 7) ?? fallbackMois

  const currentCategory = resa.reservation_status?.current?.category || resa.status || 'accepted'
  const isCancelled = ['not_accepted', 'not accepted', 'declined', 'expired'].includes(currentCategory)

  return {
    hospitable_id: resa.id,
    bien_id: bien.id,
    code: resa.code,
    platform: resa.platform === 'booking.com' ? 'booking' : resa.platform,
    platform_id: resa.platform_id,
    arrival_date: resa.arrival_date?.substring(0, 10),
    departure_date: resa.departure_date?.substring(0, 10),
    nights: resa.nights,
    checkin_time: resa.check_in,
    checkout_time: resa.check_out,
    guest_name: [resa.guest?.first_name, resa.guest?.last_name].filter(Boolean).join(' ') || null,
    guest_count: resa.guest_count || resa.guests?.total || null,
    stay_type: resa.stay_type || 'guest',
    // Hospitable v2 renvoie un objet {schedule_cleaning:...} pour les séjours proprio
    owner_stay: typeof resa.owner_stay === 'boolean' ? resa.owner_stay : (resa.owner_stay != null && resa.owner_stay !== false),
    reservation_status: resa.reservation_status,
    final_status: currentCategory,
    fin_accommodation: fin.accommodation?.amount ?? null,
    // Forcer 0 pour les resas annulées/refusées (Airbnb renvoie parfois un revenue non nul)
    fin_revenue: isCancelled ? 0 : (fin.revenue?.amount ?? null),
    fin_host_service_fee: hostServiceFee?.amount ?? null,
    fin_taxes_total: taxesTotal || null,
    fin_currency: fin.currency || 'EUR',
    mois_comptable: moisComptable,
    hospitable_raw: resa,
  }
}

// ── Sync fees détaillés ────────────────────────────────────────────────────────

async function syncReservationFees(sb: any, reservationId: string, hostFin: any) {
  await sb.from('reservation_fee').delete().eq('reservation_id', reservationId)

  const fees: any[] = []

  for (const fee of (hostFin.guest_fees || [])) {
    fees.push({ reservation_id: reservationId, fee_type: 'guest_fee', label: fee.label, category: fee.category, amount: fee.amount, formatted: fee.formatted })
  }
  for (const fee of (hostFin.host_fees || [])) {
    fees.push({ reservation_id: reservationId, fee_type: 'host_fee', label: fee.label, category: fee.category, amount: fee.amount, formatted: fee.formatted })
  }
  for (const tax of (hostFin.taxes || [])) {
    fees.push({ reservation_id: reservationId, fee_type: 'tax', label: tax.label, category: tax.category, amount: tax.amount, formatted: tax.formatted })
  }
  for (const night of (hostFin.accommodation_breakdown || [])) {
    fees.push({ reservation_id: reservationId, fee_type: 'accommodation_night', label: night.label, category: night.category, amount: night.amount, formatted: night.formatted, nuit_date: night.label })
  }

  if (fees.length > 0) {
    const { error } = await sb.from('reservation_fee').insert(fees)
    if (error) console.error('Erreur insert fees:', error.message)
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const body = await req.json().catch(() => ({}))
  const agence  = body.agence   ?? 'dcb'
  const dryRun  = body.dry_run  ?? false
  const annee   = body.annee    ?? new Date().getFullYear()

  const startDate = `${annee}-01-01`
  const endDate   = `${annee}-12-31`

  const log = { created: 0, updated: 0, errors: 0, total: 0, errorDetails: [] as any[] }

  try {
    // 1. Biens actifs
    const { data: biens, error: biensErr } = await sb
      .from('bien')
      .select('id, hospitable_id, proprietaire_id, provision_ae_ref, forfait_dcb_ref, has_ae, gestion_loyer, agence')
      .not('hospitable_id', 'is', null)
      .eq('listed', true)
      .eq('agence', agence)

    if (biensErr) throw biensErr
    if (!biens?.length) throw new Error('Aucun bien actif trouvé')

    const bienByHospId = new Map(biens.map((b: any) => [b.hospitable_id, b]))
    const hospIds = biens.map((b: any) => b.hospitable_id)

    // 2. Réservations existantes dans Supabase pour l'année (pour créé/mis à jour)
    const { data: existing } = await sb
      .from('reservation')
      .select('id, hospitable_id')
      .gte('mois_comptable', `${annee}-01`)
      .lte('mois_comptable', `${annee}-12`)

    const existingMap = new Map((existing || []).map((r: any) => [r.hospitable_id, r]))

    // 3. Fetch toutes les réservations de l'année par batch de 10 biens
    const BATCH = 10
    const allResas: any[] = []

    for (let i = 0; i < hospIds.length; i += BATCH) {
      const batch: string[] = hospIds.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        batch.map(async (hospId: string) => {
          const resas = await fetchAll('/reservations', {
            properties: [hospId],
            include: 'financials,guest',
            start_date: startDate,
            end_date: endDate,
          })
          resas.forEach((r: any) => { r._property_id = hospId })
          return resas
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled') allResas.push(...r.value)
        else console.error('Erreur fetch batch:', r.reason?.message)
      }
    }

    log.total = allResas.length

    // 4. Upsert chaque réservation
    for (const resa of allResas) {
      try {
        const bien = bienByHospId.get(resa._property_id)
        if (!bien) continue

        const parsed = parseReservation(resa, bien, `${annee}-01`)

        if (dryRun) {
          log.updated++
          continue
        }

        const { data: upserted, error } = await sb
          .from('reservation')
          .upsert(
            parsed.guest_name ? parsed : { ...parsed, guest_name: undefined },
            { onConflict: 'hospitable_id' }
          )
          .select('id')
          .single()

        if (error) throw error

        if (resa.financials?.host) {
          await syncReservationFees(sb, upserted.id, resa.financials.host)
        }

        // Payout synthétique Airbnb (pour rapprochement bancaire)
        if (resa.platform === 'airbnb' && parsed.fin_revenue && parsed.arrival_date && bien.gestion_loyer !== false) {
          await sb.from('payout_hospitable').upsert({
            hospitable_id: resa.id + '_airbnb_payout',
            platform: 'airbnb',
            amount: parsed.fin_revenue,
            date_payout: parsed.arrival_date,
            mois_comptable: parsed.mois_comptable,
            statut_matching: 'en_attente',
          }, { onConflict: 'hospitable_id', ignoreDuplicates: false })
        }

        if (existingMap.has(resa.id)) log.updated++
        else log.created++

      } catch (err: any) {
        console.error(`Erreur résa ${resa.code}:`, err?.message)
        log.errors++
        log.errorDetails.push({ code: resa.code || resa.id, message: err?.message || String(err) })
      }
    }

    // 5. Import log
    if (!dryRun) {
      await sb.from('import_log').insert({
        type: 'sync_reservations_cron',
        mois_concerne: `${annee}`,
        statut: log.errors > 0 ? 'partial' : 'success',
        nb_lignes_traitees: log.total,
        nb_lignes_creees: log.created,
        nb_lignes_mises_a_jour: log.updated,
        nb_erreurs: log.errors,
        message: `Cron sync ${annee} — ${log.created} créées, ${log.updated} mises à jour, ${log.errors} erreurs`,
      })
    }

    return new Response(JSON.stringify({ ok: true, annee, agence, dry_run: dryRun, log }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('sync-reservations-cron error:', err?.message)
    try {
      await sb.from('import_log').insert({
        type: 'sync_reservations_cron',
        mois_concerne: `${annee}`,
        statut: 'error',
        nb_erreurs: 1,
        message: err?.message,
      })
    } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: err?.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
