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

    // 1. Fiche AE
    const { data: ae, error: aeErr } = await sb.from('auto_entrepreneur').select('id, nom, prenom, ical_url').eq('id', ae_id).single()
    if (aeErr || !ae) return new Response(JSON.stringify({ error: 'AE introuvable' }), { status: 404 })
    if (!ae.ical_url) return new Response(JSON.stringify({ error: 'URL iCal non configurée pour cet AE', created: 0 }), { status: 200 })

    // 2. Biens — match par ical_code (préfixe du code dans le titre), avec fallback par nom
    //    normalisé (sans accents/espaces/punct, tronqué 16) → reproduit le code source iCal.
    //    Le fallback évite les missions orphelines quand un bien n'a pas (ou mal) son ical_code.
    const normCode = (s: string) => (s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]/g, '').slice(0, 16)
    const { data: biens } = await sb.from('bien').select('id, ical_code, hospitable_name')
    const bienList = (biens || []).map((b: any) => ({ ...b, _normCode: normCode(b.hospitable_name) }))

    // 3. Fetch iCal
    const icalUrl = ae.ical_url.replace(/^webcal:/, 'https:')
    const icalResp = await fetch(icalUrl)
    if (!icalResp.ok) return new Response(JSON.stringify({ error: 'Erreur fetch iCal: ' + icalResp.status }), { status: 500 })
    const icalText = await icalResp.text()
    const events = parseIcal(icalText)

    // 4. Périmètre : à partir du 1er jour du mois passé → ce mois + TOUT le futur.
    //    (couvre les missions à venir des mois suivants, plus seulement le mois courant)
    const [annee, moisNum] = mois.split('-').map(Number)
    const dateDebutStr = `${annee}-${String(moisNum).padStart(2, '0')}-01`
    const moisDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

    const findBien = (codeInTitle: string) =>
      bienList.find(b => b.ical_code && codeInTitle.startsWith(b.ical_code)) ||   // 1) match ical_code
      bienList.find(b => b._normCode && codeInTitle.startsWith(b._normCode)) ||   // 2) fallback nom normalisé
      null

    // Normaliser les events du périmètre
    type Ev = { uid: string | null; titre: string; dateStr: string; mois: string; bien: any; duree: number | null; cancelled: boolean; isCleaningCheckout: boolean }
    const evs: Ev[] = []
    for (const e of events) {
      const titre = e.summary || ''
      const m = titre.match(/\(([^)]+)\)/)
      if (!m) continue // pas de (code) → ignoré (comportement inchangé)
      const d = parseIcalDate(e.dtstart)
      if (!d) continue
      const dateStr = d.toISOString().substring(0, 10)
      if (dateStr < dateDebutStr) continue // passé → on ne touche pas l'historique
      const titreLC = titre.toLowerCase()
      evs.push({
        uid: e.uid || null,
        titre,
        dateStr,
        mois: moisDe(d),
        bien: findBien(m[1]),
        duree: computeDureeHeures(e.dtstart, e.dtend),
        cancelled: e.status?.toUpperCase() === 'CANCELLED',
        isCleaningCheckout: titreLC.startsWith('cleaning') || titreLC.startsWith('check-out') || titreLC.startsWith('checkout'),
      })
    }

    // 5. Préchargements (évite les requêtes par event) ───────────────────────
    // 5a. Missions existantes de l'AE sur le périmètre
    const { data: existing } = await sb.from('mission_menage')
      .select('id, ical_uid, statut, reservation_id, ventilation_auto_id, date_mission')
      .eq('ae_id', ae.id)
      .gte('date_mission', dateDebutStr)
      .not('ical_uid', 'is', null)
    const existingByUid = new Map((existing || []).map(m => [m.ical_uid, m]))

    // 5b. Réservations candidates (pour lier mission ↔ résa ↔ ventilation AUTO)
    const linkEvts = evs.filter(e => !e.cancelled && e.bien && e.uid && e.isCleaningCheckout)
    const bienIds = [...new Set(linkEvts.map(e => e.bien.id))]
    const depDates = new Set<string>()
    for (const e of linkEvts) {
      depDates.add(e.dateStr)
      const d1 = new Date(e.dateStr + 'T12:00:00Z'); d1.setUTCDate(d1.getUTCDate() + 1)
      depDates.add(d1.toISOString().substring(0, 10))
    }
    const resaMap = new Map<string, string>() // `${bien_id}|${departure_date}` → resa_id
    const resaIds: string[] = []
    if (bienIds.length && depDates.size) {
      const { data: resas } = await sb.from('reservation')
        .select('id, bien_id, departure_date')
        .eq('final_status', 'accepted')
        .in('bien_id', bienIds)
        .in('departure_date', [...depDates])
      for (const r of resas || []) {
        const key = `${r.bien_id}|${r.departure_date}`
        if (!resaMap.has(key)) { resaMap.set(key, r.id); resaIds.push(r.id) }
      }
    }
    // 5c. Ventilations AUTO des résas trouvées
    const ventilMap = new Map<string, string>() // resa_id → ventilation_id
    if (resaIds.length) {
      const { data: ventils } = await sb.from('ventilation').select('id, reservation_id').eq('code', 'AUTO').in('reservation_id', resaIds)
      for (const v of ventils || []) if (!ventilMap.has(v.reservation_id)) ventilMap.set(v.reservation_id, v.id)
    }
    const matchResa = (e: Ev): { resa_id: string | null; ventil_id: string | null } => {
      if (!e.bien || !e.isCleaningCheckout) return { resa_id: null, ventil_id: null }
      for (const offset of [0, 1]) {
        const d = new Date(e.dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset)
        const rid = resaMap.get(`${e.bien.id}|${d.toISOString().substring(0, 10)}`)
        if (rid) return { resa_id: rid, ventil_id: ventilMap.get(rid) ?? null }
      }
      return { resa_id: null, ventil_id: null }
    }

    // 6. Construire les lots insert / update / cancel ─────────────────────────
    const toInsert: any[] = []
    const toUpdate: any[] = []
    const cancelUids: string[] = []
    const reactivateUids: string[] = [] // missions cancelled dont l'event est réapparu (actif) dans le flux

    for (const e of evs) {
      if (e.cancelled) { if (e.uid) cancelUids.push(e.uid); continue }
      const { resa_id, ventil_id } = matchResa(e)
      const base: any = {
        ae_id: ae.id,
        bien_id: e.bien?.id || null,
        date_mission: e.dateStr,
        titre_ical: e.titre,
        ical_uid: e.uid,
        mois: e.mois,
        type_mission: 'checkout',
        imputation: 'ventilation_dcb',
        duree_prevue: e.duree,
      }
      const prev = e.uid ? existingByUid.get(e.uid) : null
      if (prev) {
        // Préserver un lien résa déjà établi (ex. manuel) ; sinon poser le match
        base.reservation_id = prev.reservation_id ?? resa_id
        base.ventilation_auto_id = prev.reservation_id ? prev.ventilation_auto_id : ventil_id
        toUpdate.push(base) // statut NON inclus → préservé à l'upsert
        // Event présent+actif mais mission annulée → la réactiver (résa réapparue)
        if (prev.statut === 'cancelled' && e.uid) reactivateUids.push(e.uid)
      } else {
        base.reservation_id = resa_id
        base.ventilation_auto_id = ventil_id
        base.statut = 'planifie'
        toInsert.push(base)
      }
    }

    let created = 0, updated = 0
    if (toInsert.length) {
      // ignoreDuplicates : insère les nouvelles, ignore un éventuel doublon (sans toucher son statut)
      const { error } = await sb.from('mission_menage').upsert(toInsert, { onConflict: 'ical_uid', ignoreDuplicates: true })
      if (!error) created = toInsert.length
    }
    if (toUpdate.length) {
      // onConflict ical_uid → UPDATE des colonnes fournies uniquement (statut préservé)
      const { error } = await sb.from('mission_menage').upsert(toUpdate, { onConflict: 'ical_uid' })
      if (!error) updated = toUpdate.length
    }
    if (cancelUids.length) {
      await sb.from('mission_menage').update({ statut: 'cancelled' }).in('ical_uid', cancelUids)
    }
    let reactivated = 0
    if (reactivateUids.length) {
      const { error } = await sb.from('mission_menage').update({ statut: 'planifie' }).in('ical_uid', reactivateUids).eq('statut', 'cancelled')
      if (!error) reactivated = reactivateUids.length
    }

    // 7. Réconciliation : missions en DB (périmètre) absentes du feed → cancelled
    const feedUids = new Set(evs.map(e => e.uid).filter(Boolean))
    const orphelins = (existing || []).filter(m => m.statut !== 'cancelled' && !feedUids.has(m.ical_uid)).map(m => m.id)
    if (orphelins.length) {
      await sb.from('mission_menage').update({ statut: 'cancelled' }).in('id', orphelins)
    }

    return new Response(JSON.stringify({ created, updated, reactivated, skipped: 0, total: evs.length, cancelled: cancelUids.length + orphelins.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})

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
  return new Date(Date.UTC(
    parseInt(clean.substring(0, 4)),
    parseInt(clean.substring(4, 6)) - 1,
    parseInt(clean.substring(6, 8))
  ))
}
