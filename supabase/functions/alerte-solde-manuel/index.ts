/**
 * alerte-solde-manuel — Edge Function Supabase (cron quotidien 8h05 UTC via pg_cron)
 *
 * Failsafe : alerte le staff quand une réservation manuelle/directe (paiement encaissé
 * par l'agence, pas par une OTA) arrive dans ≤ 15 jours sans que le solde ait été
 * intégralement reçu (calculé sur reservation_paiement, PAS sur le seul flag rapprochee —
 * un failsafe se fie aux montants réels, pas à un statut qui peut être en retard/faux).
 *
 * Un seul mail récap quotidien tant qu'au moins une résa est à risque (pas d'escalade à
 * compteur type relance-debours) : s'arrête de lui-même dès que le solde est encaissé.
 *
 * Un seul Edge Function partagé (comme ventilation-auto) — l'agence vient du body du
 * cron, PAS d'un secret Deno.env (ce projet Supabase est unique et partagé DCB/Lauian,
 * il n'y a pas de secret AGENCE qui varie par déploiement ici). Deux jobs pg_cron
 * distincts appellent cette même fonction avec {"agence":"dcb"} et {"agence":"lauian"}.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const JOURS_FENETRE = 15
const STAFF_EMAIL: Record<string, string> = {
  dcb: 'oihan@destinationcotebasque.com',
  lauian: 'lauracoursan@hotmail.fr',
}

function fmtEur(cts: number) {
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function htmlRecap(rows: {
  guestName: string; bienCode: string; arrival: string; joursRestants: number;
  manque: string; total: string; email: string | null; phone: string | null;
}[]) {
  const lignes = rows.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416"><strong>${r.guestName}</strong><br><span style="color:#9C8E7D;font-size:11px">${r.bienCode}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${r.arrival}<br><span style="color:${r.joursRestants <= 3 ? '#C0392B' : '#9C8E7D'};font-size:11px;font-weight:${r.joursRestants <= 3 ? 'bold' : 'normal'}">${r.joursRestants < 0 ? 'arrivée passée' : `J-${r.joursRestants}`}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${r.manque}<br><span style="color:#9C8E7D;font-size:11px;font-weight:normal">/ ${r.total}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:12px;color:#666">${r.email ? `✉ ${r.email}<br>` : ''}${r.phone ? `📞 ${r.phone}` : (!r.email ? '<span style="color:#C0392B">aucun contact en base</span>' : '')}</td>
    </tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:640px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Soldes manquants — réservations manuelles/directes</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${rows.length} réservation${rows.length > 1 ? 's' : ''} · arrivée dans ≤ ${JOURS_FENETRE} jours</p>
      </td></tr>
      <tr><td style="padding:24px 0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Locataire / Bien</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Arrivée</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Manque / Total</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Contact</th></tr>
          ${lignes}
        </table>
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement chaque matin tant qu'un solde manque — s'arrête dès l'encaissement rapproché.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
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
    .select('id, guest_name, guest_email, guest_phone, arrival_date, fin_revenue, bien!inner(code, agence)')
    .in('platform', ['manual', 'direct'])
    .not('final_status', 'in', '("not accepted","cancelled")')
    .gt('fin_revenue', 0)
    .gte('arrival_date', today)
    .lte('arrival_date', dateMax)
    .eq('bien.agence', AGENCE)
    .order('arrival_date')
  if (error) return json({ error: error.message }, 500)

  if (!resas?.length) return json({ ok: true, agence: AGENCE, total: 0, alerted: 0 })

  const ids = resas.map(r => r.id)
  const { data: paiements } = await supabase
    .from('reservation_paiement')
    .select('reservation_id, montant')
    .in('reservation_id', ids)
  const payeByResa: Record<string, number> = {}
  for (const p of paiements || []) payeByResa[p.reservation_id] = (payeByResa[p.reservation_id] || 0) + (p.montant || 0)

  const now = new Date(today + 'T00:00:00')
  const risques = resas
    .map(r => {
      const paye = payeByResa[r.id] || 0
      const manque = (r.fin_revenue || 0) - paye
      const joursRestants = Math.round((new Date(r.arrival_date + 'T00:00:00').getTime() - now.getTime()) / 86400_000)
      return { r, paye, manque, joursRestants }
    })
    .filter(x => x.manque > 0)

  if (!risques.length) return json({ ok: true, agence: AGENCE, total: resas.length, alerted: 0 })

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

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `⚠ ${risques.length} solde${risques.length > 1 ? 's' : ''} manquant${risques.length > 1 ? 's' : ''} — réservation${risques.length > 1 ? 's' : ''} manuelle${risques.length > 1 ? 's' : ''}/directe${risques.length > 1 ? 's' : ''}`,
        html: htmlRecap(rows),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_solde_manuel', source: 'cron', statut: 'ok',
      message: `${risques.length} résa(s) manuelle(s)/directe(s) avec solde manquant (agence ${AGENCE}), alerte envoyée à ${to}`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: resas.length, alerted: risques.length, rows })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
