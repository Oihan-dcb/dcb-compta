/**
 * audit-rattachement-menages — Edge Function (07/10/2026), LECTURE SEULE par défaut.
 *
 * Compare le rattachement mission de ménage ↔ séjour fait par l'app (deviné par bien + date de
 * départ, sync-ical-ae avant le 07/10/2026) à la réservation portée par la tâche Hospitable elle-même
 * (uid iCal = « <task_id>@smartbnb.io »). Liste les écarts pour validation par Oïhan AVANT toute
 * correction.
 *
 * POST { depuis?: 'YYYY-MM-DD' (déf. 2026-06-01), jusqu_a?: 'YYYY-MM-DD' (déf. aujourd'hui),
 *      }
 * Catégories : 'different' (rattachée à une autre résa que celle de la tâche), 'manquant' (pas de
 * résa, la tâche en a une), 'tache_sans_resa' (la tâche n'a pas de résa : maintenance…),
 * 'tache_introuvable' (tâche supprimée ou autre compte Hospitable), 'resa_inconnue' (résa de la
 * tâche absente de l'app). Missions force_rattache (rattachement manuel) : signalées, jamais corrigées.
 * DIAGNOSTIC UNIQUEMENT (07/10/2026) : la réservation d'une tâche Hospitable n'est PAS une source
 * fiable du séjour qui a payé le ménage — selon la règle de tâche, Hospitable rattache le ménage au
 * séjour qui ARRIVE (PANTXIKA 24/06 → séjour du 24 au 29/06 au lieu du départ du 24/06) et parfois
 * à une résa annulée (VIKY 19/07). Ne jamais s'en servir pour corriger automatiquement.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const HOSP_TOKEN   = Deno.env.get('HOSPITABLE_TOKEN') ?? ''
const HOSP_BASE    = 'https://public.api.hospitable.com/v2'

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d, null, 2), { status, headers: { 'Content-Type': 'application/json' } })

async function tachesHospitable(propIds: string[], debut: string, fin: string) {
  const parTache = new Map<string, { hid: string | null; code: string | null }>()
  for (let i = 0; i < propIds.length; i += 40) {
    const lot = propIds.slice(i, i + 40)
    for (let page = 1; page <= 30; page++) {
      const qs = lot.map(id => `properties[]=${encodeURIComponent(id)}`).join('&') + `&start_date=${debut}&end_date=${fin}&per_page=100&page=${page}`
      const r = await fetch(`${HOSP_BASE}/tasks?${qs}`, { headers: { Authorization: `Bearer ${HOSP_TOKEN}`, Accept: 'application/json' } })
      if (!r.ok) throw new Error(`Hospitable tasks ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const j = await r.json()
      for (const t of j.data || []) parTache.set(t.id, { hid: t.reservation?.id || null, code: t.reservation?.code || null })
      if (!j.meta || j.meta.current_page >= j.meta.last_page) break
    }
  }
  return parTache
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  let body: { depuis?: string; jusqu_a?: string } = {}
  try { body = await req.json() } catch { /* GET */ }
  const depuis = body.depuis || '2026-06-01'
  const jusqu_a = body.jusqu_a || new Date().toISOString().slice(0, 10)
  if (!HOSP_TOKEN) return json({ error: 'HOSPITABLE_TOKEN absent' }, 500)
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  const missions: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('mission_menage')
      .select('id, ical_uid, date_mission, montant, statut, type_mission, reservation_id, ventilation_auto_id, force_rattache, ae:ae_id(prenom), bien:bien_id(id, code, agence, hospitable_id), reservation:reservation_id(code, hospitable_id, departure_date, final_status)')
      .like('ical_uid', '%@smartbnb.io').neq('statut', 'cancelled')
      .gte('date_mission', depuis).lte('date_mission', jusqu_a).order('date_mission').range(from, from + 999)
    if (error) return json({ error: error.message }, 500)
    missions.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  const props = [...new Set(missions.map(m => m.bien?.hospitable_id).filter(Boolean))] as string[]
  const d0 = new Date(depuis + 'T12:00:00Z'); d0.setUTCDate(d0.getUTCDate() - 2)
  const d1 = new Date(jusqu_a + 'T12:00:00Z'); d1.setUTCDate(d1.getUTCDate() + 2)
  let parTache: Map<string, { hid: string | null; code: string | null }>
  try { parTache = await tachesHospitable(props, d0.toISOString().slice(0, 10), d1.toISOString().slice(0, 10)) }
  catch (e) { return json({ error: (e as Error).message }, 502) }

  const hids = [...new Set([...parTache.values()].map(x => x.hid).filter(Boolean))] as string[]
  const parHid = new Map<string, any>()
  for (let i = 0; i < hids.length; i += 100) {
    const { data } = await sb.from('reservation').select('id, code, hospitable_id, departure_date, final_status').in('hospitable_id', hids.slice(i, i + 100))
    for (const r of data || []) parHid.set(r.hospitable_id, r)
  }

  const ecarts: any[] = []
  const compte: Record<string, number> = { ok: 0 }
  for (const m of missions) {
    const tid = (m.ical_uid || '').split('@')[0]
    const t = parTache.get(tid)
    let cat = 'ok', cible: any = null
    if (!t) cat = 'tache_introuvable'
    else if (!t.hid) cat = m.reservation_id ? 'tache_sans_resa' : 'ok'
    else {
      cible = parHid.get(t.hid)
      if (!cible) cat = 'resa_inconnue'
      else if (!m.reservation_id) cat = 'manquant'
      else if (m.reservation_id !== cible.id) cat = 'different'
    }
    compte[cat] = (compte[cat] || 0) + 1
    if (cat === 'ok') continue
    ecarts.push({
      id: m.id, categorie: cat, date: m.date_mission, bien: m.bien?.code, agence: m.bien?.agence, ae: m.ae?.prenom,
      type: m.type_mission, statut: m.statut, montant: m.montant, force_rattache: !!m.force_rattache,
      resa_actuelle: m.reservation ? `${m.reservation.code} (départ ${m.reservation.departure_date}, ${m.reservation.final_status})` : null,
      resa_tache: cible ? `${cible.code} (départ ${cible.departure_date}, ${cible.final_status})` : (t?.code || null),
      cible_id: cible?.id || null,
    })
  }

  return json({ depuis, jusqu_a, missions: missions.length, taches_hospitable: parTache.size, compte, ecarts })
})
