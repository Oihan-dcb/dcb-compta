/**
 * alerte-sejour-sans-menage — Edge Function Supabase (cron quotidien 8h25 UTC via pg_cron)
 *
 * Failsafe demandé par Oïhan le 06/10/2026, suite à l'incident VILLA BACALAN : aucune tâche
 * « Cleaning » n'existait dans Hospitable pour ce bien. Léa (Bordeaux) faisait les ménages mais,
 * sans tâche, rien n'arrivait dans son calendrier → aucune mission_menage → la ventilation a
 * donné tout le ménage voyageur au forfait DCB, et sa facture de 700 € (ménages + linge + laverie)
 * a été payée par le séquestre sans aucune mission en face (alerte « AE payés au-delà » du
 * justificatif séquestre). Même trou sur VILLA AGERREA.
 *
 * Symétrique de alerte-mission-menage-orpheline (mission SANS séjour) : ici, séjour SANS mission.
 *  • À VENIR : départ aujourd'hui → J+2 sans mission → créer la tâche Cleaning dans Hospitable
 *    (assignée à l'AE) AVANT le passage, sinon le ménage ne sera ni planifié ni compté.
 *  • PASSÉS : départ entre DATE_MIN et hier toujours sans mission → ménage fait mais jamais saisi
 *    (coût AE non compté, forfait ménage DCB surévalué) ou ménage oublié.
 *
 * Une mission « couvre » le séjour si elle est sur le même bien, pas annulée/refusée, et soit
 * rattachée à la résa (reservation_id), soit datée du jour du départ à J+2 (même fenêtre que le
 * rattachement sync-ical-ae + ménage du lendemain). Tout type de mission compte (salariée incluse) :
 * l'alerte vérifie qu'un ménage est PRÉVU, pas qui le paie.
 *
 * Exclusions : résa non acceptée ; ménage de séjour proprio annulé (reservation.menage_proprio_annule,
 * migration 334) ; prolongation (résa suivante sur le même bien, même voyageur, arrivée le jour du
 * départ) ; séjour marqué reservation.sans_menage_motif (migration 338 — soupape pour un cas légitime :
 * ménage fait par le propriétaire, bien rendu…).
 *
 * Même architecture que les autres alerte-* : un Edge Function partagé DCB/Lauïan (agence dans le
 * body du cron), mail récap qui s'arrête de lui-même dès que la mission existe, LECTURE SEULE sur
 * les données métier (seule écriture : la ligne d'audit journal_ops). ?dry_run=true → rien envoyé.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signaler, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const STATUTS_HORS = ['cancelled', 'refuse', 'annule']
const JOURS_AVANT  = 2            // préventif : départs d'aujourd'hui à J+2
const JOURS_APRES  = 2            // une mission jusqu'à J+2 après le départ couvre le séjour
const LOOKBACK     = 45           // passés : départs des 45 derniers jours…
const DATE_MIN     = '2026-09-01' // …et jamais avant (été 2026 traité à la main le 06/10/2026)

const SOURCE = 'sejour_sans_menage'

function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })
}

type Row = { depart: string; bien: string; resa: string; voyageur: string; plateforme: string; proprio: boolean }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean; agence?: string } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true || new URL(req.url).searchParams.get('dry_run') === 'true'
  const AGENCE = body.agence || 'dcb'

  const today = new Date().toISOString().slice(0, 10)
  const debut = [addDays(today, -LOOKBACK), DATE_MIN].sort().pop()!
  const fin   = addDays(today, JOURS_AVANT)

  const { data: resas, error } = await supabase.from('reservation')
    .select('id, code, platform, guest_name, arrival_date, departure_date, owner_stay, menage_proprio_annule, sans_menage_motif, bien_id, bien:bien_id!inner(code, hospitable_name, agence)')
    .eq('bien.agence', AGENCE).eq('final_status', 'accepted')
    .gte('departure_date', debut).lte('departure_date', fin)
  if (error) return json({ error: error.message }, 500)

  const candidats = (resas || []).filter((r: any) => !r.menage_proprio_annule && !(r.sans_menage_motif || '').trim())
  if (!candidats.length) {
    if (!dryRun) await signaler(supabase, SOURCE, AGENCE, [])
    return json({ ok: true, agence: AGENCE, a_venir: 0, passes: 0 })
  }

  const bienIds = [...new Set(candidats.map((r: any) => r.bien_id))]
  const [{ data: missions, error: eM }, { data: suivantes, error: eS }] = await Promise.all([
    supabase.from('mission_menage').select('bien_id, reservation_id, date_mission, statut')
      .in('bien_id', bienIds).gte('date_mission', debut).lte('date_mission', addDays(fin, JOURS_APRES)),
    supabase.from('reservation').select('bien_id, guest_name, arrival_date')
      .in('bien_id', bienIds).eq('final_status', 'accepted').gte('arrival_date', debut).lte('arrival_date', fin),
  ])
  if (eM || eS) return json({ error: (eM || eS)!.message }, 500)
  const actives = (missions || []).filter((m: any) => !STATUTS_HORS.includes(m.statut))

  const couvert = (r: any) => actives.some((m: any) => m.bien_id === r.bien_id &&
    (m.reservation_id === r.id || (m.date_mission >= r.departure_date && m.date_mission <= addDays(r.departure_date, JOURS_APRES))))
  const prolongation = (r: any) => (suivantes || []).some((s: any) => s.bien_id === r.bien_id &&
    s.arrival_date === r.departure_date && r.guest_name && s.guest_name === r.guest_name)

  const manquants = candidats.filter((r: any) => !couvert(r) && !prolongation(r))
    .sort((a: any, b: any) => a.departure_date.localeCompare(b.departure_date))
  const toRow = (r: any): Row => ({
    depart: r.departure_date, bien: r.bien?.hospitable_name || r.bien?.code || '—', resa: r.code || '—',
    voyageur: r.guest_name || '—', plateforme: r.platform || '—', proprio: !!r.owner_stay,
  })
  const aVenir = manquants.filter((r: any) => r.departure_date >= today).map(toRow)
  const passes = manquants.filter((r: any) => r.departure_date < today).map(toRow)

  if (!aVenir.length && !passes.length) {
    if (!dryRun) await signaler(supabase, SOURCE, AGENCE, [])
    return json({ ok: true, agence: AGENCE, a_venir: 0, passes: 0 })
  }

  // À venir = urgence opérationnelle (ménage à planifier avant le départ) : detail.urgent → passe
  // aussi le week-end dans le Point du matin. Passés : coût AE / forfait à régulariser.
  const items: ItemAlerte[] = [
    ...aVenir.map(r => ({
      cle: `resa:${r.resa}`,
      libelle: `${r.bien} — départ ${r.depart.split('-').reverse().join('/')} (${r.voyageur}, ${r.plateforme}${r.proprio ? ', séjour proprio' : ''}) sans mission de ménage : créer la tâche Cleaning dans Hospitable`,
      detail: { resa: r.resa, depart: r.depart, urgent: true },
    })),
    ...passes.map(r => ({
      cle: `resa:${r.resa}`,
      libelle: `${r.bien} — départ ${r.depart.split('-').reverse().join('/')} (${r.voyageur}, ${r.plateforme}${r.proprio ? ', séjour proprio' : ''}) passé sans mission de ménage`,
      detail: { resa: r.resa, depart: r.depart },
    })),
  ]
  if (!dryRun) {
    const res = await signaler(supabase, SOURCE, AGENCE, items)
    await supabase.from('journal_ops').insert({
      categorie: 'menage', action: 'alerte_sejour_sans_menage', source: 'cron', statut: 'warning',
      message: `${aVenir.length} départ(s) à venir et ${passes.length} départ(s) passé(s) sans mission de ménage (agence ${AGENCE}) — ${res.nouveaux} nouveau(x), publié(s) pour le Point du matin`,
    })
  }
  return json({ dry_run: dryRun, agence: AGENCE, debut, fin, a_venir: aVenir, passes })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
