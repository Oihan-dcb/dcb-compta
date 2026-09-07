/**
 * alerte-solde-booking-platform — Edge Function Supabase (cron quotidien 8h09 UTC via pg_cron)
 *
 * Failsafe pour deux trous de surveillance découverts le 30/08/2026 en enquêtant sur la
 * clôture août dcb-compta (voir mémoire project_contrat_annule_ne_maj_pas_reservation) :
 *
 * 1. `mode_paiement='booking_platform'` (résas Direct/Manual où le contrat suppose que
 *    Hospitable encaisse — voir dcb-planning/api/cron-auto-contracts.js) ne planifie jamais
 *    de prélèvement, et [[alerte-solde-manuel]] ne surveille que les modes virement à venir.
 *    Aucun filet ne vérifie après coup que l'argent est réellement arrivé après `date_solde`.
 *    Cas trouvés : HOST-AX90XD (3447,09€, 24j de retard) et HOST-WSW44G (862€, 30j de retard).
 *
 * 2. Un contrat `rental_contracts.statut='cancelled'` ne propage jamais l'annulation vers
 *    `reservation.final_status` — la réservation reste active et ventilée indéfiniment.
 *    Cas trouvés : YGWYZL, HOST-5DNMNT, HOST-8PJIH7, HOST-0XN4AF.
 *    Volontairement PAS d'auto-annulation ici : un contrat peut être annulé APRÈS un séjour
 *    déjà eu lieu (cas HOST-TJNPFC — cliente restée sans jamais payer, contrat annulé a
 *    posteriori) — auto-annuler la réservation effacerait un vrai séjour. Alerte uniquement,
 *    décision humaine.
 *
 * Même architecture que alerte-solde-manuel : un seul Edge Function partagé DCB/Lauian,
 * agence passée dans le body du cron, mail récap quotidien qui s'arrête de lui-même dès que
 * la situation est résolue (rapprochee=true ou reservation réellement annulée).
 *
 * owner_stay exclu des deux sections (ajouté le 07/09/2026, même bug que alerte-solde-manuel
 * cf. project_alerte_solde_manuel) : un séjour propriétaire manuel peut avoir un contrat
 * auto-généré puis annulé (pas un vrai locataire), ou un guest_name = nom du propriétaire —
 * sans ce filtre, 3 des 19 lignes "Contrat annulé" de la section 2 étaient les propriétaires
 * eux-mêmes (Andrea/SCI du Tourmalet-MUNDUZ, Dominique belair/408P, Vincent Balhadere×2).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

function htmlRecap(
  soldes: { guestName: string; bienCode: string; dateSolde: string; retard: number; montant: string }[],
  annulees: { guestName: string; bienCode: string; arrival: string; montant: string }[],
) {
  const ligneSolde = soldes.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416"><strong>${r.guestName}</strong><br><span style="color:#9C8E7D;font-size:11px">${r.bienCode}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${r.dateSolde}<br><span style="color:#C0392B;font-size:11px;font-weight:bold">${r.retard}j de retard</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${r.montant}</td>
    </tr>`).join('')
  const ligneAnnulees = annulees.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416"><strong>${r.guestName}</strong><br><span style="color:#9C8E7D;font-size:11px">${r.bienCode}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${r.arrival}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${r.montant}</td>
    </tr>`).join('')
  const sectionSolde = soldes.length ? `
      <tr><td style="padding:20px 24px 6px;font-size:13px;font-weight:bold;color:#2C2416">💳 Solde carte jamais confirmé (${soldes.length})</td></tr>
      <tr><td style="padding:0 0 10px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Locataire / Bien</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Solde dû le</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Montant</th></tr>
          ${ligneSolde}
        </table>
      </td></tr>` : ''
  const sectionAnnulees = annulees.length ? `
      <tr><td style="padding:20px 24px 6px;font-size:13px;font-weight:bold;color:#2C2416">⚠ Contrat annulé mais réservation encore active (${annulees.length})</td></tr>
      <tr><td style="padding:0 0 10px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Locataire / Bien</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Arrivée</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Montant</th></tr>
          ${ligneAnnulees}
        </table>
      </td></tr>` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:640px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Résas à vérifier — booking_platform / contrats annulés</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${soldes.length + annulees.length} réservation${soldes.length + annulees.length > 1 ? 's' : ''} à traiter</p>
      </td></tr>
      <tr><td style="padding:10px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${sectionSolde}
          ${sectionAnnulees}
        </table>
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement chaque matin tant qu'une situation n'est pas résolue — s'arrête dès rapprochement ou annulation réelle de la résa.
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

  // ── 1. Solde booking_platform jamais confirmé ────────────────────────────
  const { data: contratsSignes, error: errSignes } = await supabase
    .from('rental_contracts')
    .select('reservation_id, date_solde, solde_montant_cts')
    .eq('mode_paiement', 'booking_platform')
    .eq('statut', 'signed')
    .lt('date_solde', today)
    .is('solde_confirme_at', null)
  if (errSignes) return json({ error: errSignes.message }, 500)

  // ── 2. Contrat annulé mais réservation encore active ─────────────────────
  // Une même réservation peut avoir plusieurs lignes rental_contracts annulées
  // (regénérations successives) — dédupliquer par reservation_id avant tout,
  // sinon un même cas apparaît N fois dans le mail récap.
  const { data: contratsAnnulesRaw, error: errAnnules } = await supabase
    .from('rental_contracts')
    .select('reservation_id')
    .eq('statut', 'cancelled')
  if (errAnnules) return json({ error: errAnnules.message }, 500)
  const contratsAnnules = Array.from(
    new Map((contratsAnnulesRaw || []).map(c => [c.reservation_id, c])).values()
  )

  const codesAVerifier = [
    ...(contratsSignes || []).map(c => c.reservation_id),
    ...(contratsAnnules || []).map(c => c.reservation_id),
  ]
  if (!codesAVerifier.length) return json({ ok: true, agence: AGENCE, soldes: 0, annulees: 0 })

  const { data: resas } = await supabase
    .from('reservation')
    .select('code, guest_name, arrival_date, fin_revenue, rapprochee, final_status, owner_stay, bien!inner(code, agence)')
    .in('code', codesAVerifier)
    .eq('bien.agence', AGENCE)
  const resaByCode = Object.fromEntries((resas || []).map(r => [r.code, r]))

  const soldes = (contratsSignes || [])
    .map(c => {
      const r = resaByCode[c.reservation_id]
      if (!r) return null
      if (r.owner_stay) return null // séjour propriétaire, pas un solde voyageur
      if (r.rapprochee) return null // encaissé entre-temps, plus à risque
      if (['cancelled', 'not accepted'].includes(r.final_status)) return null
      if (!(r.fin_revenue > 0)) return null
      const retard = Math.round((new Date(today + 'T00:00:00').getTime() - new Date(c.date_solde + 'T00:00:00').getTime()) / 86400_000)
      return {
        guestName: r.guest_name || '—',
        bienCode: r.bien?.code || '—',
        dateSolde: fmtDate(c.date_solde),
        retard,
        montant: fmtEur(c.solde_montant_cts || r.fin_revenue || 0),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const annulees = (contratsAnnules || [])
    .map(c => {
      const r = resaByCode[c.reservation_id]
      if (!r) return null
      if (r.owner_stay) return null // séjour propriétaire — contrat auto-généré/annulé sans rapport avec un vrai locataire
      if (['cancelled', 'not accepted'].includes(r.final_status)) return null // déjà annulée, résolu
      if (!(r.fin_revenue > 0)) return null
      return {
        guestName: r.guest_name || '—',
        bienCode: r.bien?.code || '—',
        arrival: fmtDate(r.arrival_date),
        montant: fmtEur(r.fin_revenue || 0),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (!soldes.length && !annulees.length) return json({ ok: true, agence: AGENCE, soldes: 0, annulees: 0 })

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `⚠ ${soldes.length + annulees.length} résa(s) à vérifier — booking_platform / contrats annulés`,
        html: htmlRecap(soldes, annulees),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_solde_booking_platform', source: 'cron', statut: 'ok',
      message: `${soldes.length} solde(s) booking_platform non confirmé(s) + ${annulees.length} contrat(s) annulé(s) avec résa active (agence ${AGENCE}), alerte envoyée à ${to}`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, soldes: soldes.length, annulees: annulees.length, rows: { soldes, annulees } })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
