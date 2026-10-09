/**
 * alerte-solde-manuel — Edge Function Supabase (cron quotidien 8h05 UTC via pg_cron)
 *
 * Failsafe : alerte le staff quand une réservation manuelle (platform='manual' — paiement
 * encaissé par l'agence, entrée manuellement, pas via une OTA) arrive dans ≤ 15 jours sans
 * que le solde ait été intégralement reçu (calculé sur reservation_paiement, PAS sur le seul
 * flag rapprochee —
 * un failsafe se fie aux montants réels, pas à un statut qui peut être en retard/faux).
 *
 * Un seul mail récap quotidien tant qu'au moins une résa est à risque (pas d'escalade à
 * compteur type relance-debours) : s'arrête de lui-même dès que le solde est encaissé.
 *
 * Un seul Edge Function partagé (comme ventilation-auto) — l'agence vient du body du
 * cron, PAS d'un secret Deno.env (ce projet Supabase est unique et partagé DCB/Lauian,
 * il n'y a pas de secret AGENCE qui varie par déploiement ici). Deux jobs pg_cron
 * distincts appellent cette même fonction avec {"agence":"dcb"} et {"agence":"lauian"}.
 *
 * owner_stay=false obligatoire (ajouté le 07/09/2026) : un séjour propriétaire manuel a
 * guest_name = nom du propriétaire lui-même et un fin_revenue qui ne représente pas un
 * loyer voyageur dû, mais un coût ménage à sa charge — sans ce filtre, le mail listait les
 * propriétaires comme des locataires en défaut de paiement (confusion signalée par Oïhan :
 * "Peio Abeberry" / AUREAN, "Cecile Alaux" / PANORAMA, etc. — tous des séjours du
 * propriétaire dans son propre bien, jamais des voyageurs).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signaler, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const JOURS_FENETRE = 15
const SOURCE = 'solde_manuel'

function fmtEur(cts: number) {
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean; agence?: string } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true
  const AGENCE = body.agence || 'dcb'

  const today = new Date().toISOString().slice(0, 10)
  const dateMax = new Date(Date.now() + JOURS_FENETRE * 86400_000).toISOString().slice(0, 10)

  const { data: resas, error } = await supabase
    .from('reservation')
    .select('id, code, guest_name, guest_email, guest_phone, arrival_date, fin_revenue, bien!inner(code, agence)')
    .eq('platform', 'manual')
    .eq('owner_stay', false)
    .not('final_status', 'in', '("not accepted","cancelled")')
    .gt('fin_revenue', 0)
    .gte('arrival_date', today)
    .lte('arrival_date', dateMax)
    .eq('bien.agence', AGENCE)
    .order('arrival_date')
  if (error) return json({ error: error.message }, 500)

  if (!resas?.length) {
    if (!dryRun) await signaler(supabase, SOURCE, AGENCE, [])
    return json({ ok: true, agence: AGENCE, total: 0, alerted: 0 })
  }

  const ids = resas.map(r => r.id)
  const { data: paiements } = await supabase
    .from('reservation_paiement')
    .select('reservation_id, montant')
    .in('reservation_id', ids)
  const payeByResa: Record<string, number> = {}
  for (const p of paiements || []) payeByResa[p.reservation_id] = (payeByResa[p.reservation_id] || 0) + (p.montant || 0)

  // Bail mobilité (contrat type_contrat='mobilite') : loyer versé selon un échéancier sur le compte
  // LOYERS, jamais dans reservation_paiement — suivi par alerte-solde-booking-platform (section 3).
  // Cas 8B2SOT PATXI signalé à tort le 01/10/2026 (audit des alertes du 09/10/2026).
  const { data: bauxMob } = await supabase.from('rental_contracts').select('reservation_id')
    .eq('type_contrat', 'mobilite').neq('statut', 'cancelled').in('reservation_id', resas.map(r => r.code).filter(Boolean))
  const resaBail = new Set((bauxMob || []).map(b => b.reservation_id))

  const now = new Date(today + 'T00:00:00')
  const risques = resas
    .filter(r => !resaBail.has(r.code))
    .map(r => {
      const paye = payeByResa[r.id] || 0
      const manque = (r.fin_revenue || 0) - paye
      const joursRestants = Math.round((new Date(r.arrival_date + 'T00:00:00').getTime() - now.getTime()) / 86400_000)
      return { r, paye, manque, joursRestants }
    })
    .filter(x => x.manque > 0)

  if (!risques.length) {
    if (!dryRun) await signaler(supabase, SOURCE, AGENCE, [])
    return json({ ok: true, agence: AGENCE, total: resas.length, alerted: 0 })
  }

  const rows = risques.map(({ r, manque, joursRestants }) => ({
    guestName: r.guest_name || '—',
    bienCode: r.bien?.code || '—',
    arrival: fmtDate(r.arrival_date),
    joursRestants,
    manque: fmtEur(manque),
    total: fmtEur(r.fin_revenue || 0),
    email: r.guest_email,
    phone: r.guest_phone,
  }))

  const items: ItemAlerte[] = risques.map(({ r, manque, joursRestants }) => ({
    cle: `resa:${r.id}`,
    libelle: `${r.guest_name || '—'} (${r.bien?.code || '—'}) — arrivée le ${r.arrival_date.split('-').reverse().join('/')} (J-${joursRestants}), ${fmtEur(manque)} manquants sur ${fmtEur(r.fin_revenue || 0)}`,
    montant_cts: manque,
    detail: { resa: r.code, arrivee: r.arrival_date },
  }))
  if (!dryRun) {
    const res = await signaler(supabase, SOURCE, AGENCE, items)
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_solde_manuel', source: 'cron', statut: 'ok',
      message: `${risques.length} résa(s) manuelle(s) avec solde manquant (agence ${AGENCE}) — ${res.nouveaux} nouvelle(s), publiée(s) pour le Point du matin`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: resas.length, alerted: risques.length, rows })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
