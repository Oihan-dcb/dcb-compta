/**
 * alerte-virement-orphelin — Edge Function Supabase (cron quotidien 8h13 UTC via pg_cron)
 *
 * Failsafe demandé par Oïhan le 09/09/2026 : alerte quand un virement entrant OTA (Airbnb/
 * Booking) sur le compte séquestre n'a pu être rattaché à aucune réservation
 * (mouvement_bancaire.statut_matching='non_identifie' — le moteur de rapprochement
 * (src/services/rapprochement.js) a explicitement tenté et abandonné, ce n'est pas un simple
 * retard de traitement). Cas type visé : un propriétaire passe de gestion_loyer=false à true
 * — les réservations déjà synchronisées avant le changement n'ont jamais généré de ligne
 * ventilation VIR (horsSequestre était vrai au moment du calcul), donc le vrai virement
 * Airbnb qui arrive ensuite ne trouve rien à quoi se rattacher.
 *
 * 'non_identifie' est un statut TERMINAL (posé après échec du matching), à ne pas confondre
 * avec 'en_attente' qui couvre aussi un énorme historique jamais repassé au crible (des
 * centaines de mouvements 2025 jamais traités) — masse non actionnable au quotidien, donc
 * volontairement ignorée ici.
 *
 * Filtré sur canal IN ('airbnb','booking') — les circuits OTA concernés par le scénario
 * décrit — et credit > 100 (1€) pour exclure les virements-test Airbnb à 0,01€ (vérification
 * de RIB, aucune valeur informative).
 *
 * Même architecture que alerte-solde-manuel/alerte-solde-booking-platform : un seul Edge
 * Function partagé DCB/Lauian, agence passée dans le body du cron, mail récap quotidien qui
 * s'arrête de lui-même dès que le mouvement est rapproché (ou requalifié 'non_gere').
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CANAUX_OTA = ['airbnb', 'booking']
const SEUIL_CTS = 100 // 1€ — exclut les virements-test Airbnb à 0,01€

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

function htmlRecap(rows: { date: string; libelle: string; canal: string; montant: string }[]) {
  const lignes = rows.map(r => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${r.date}<br><span style="color:#9C8E7D;font-size:11px;text-transform:uppercase">${r.canal}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:12px;color:#2C2416">${r.libelle}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${r.montant}</td>
    </tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:640px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Virement(s) OTA sans réservation associée</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${rows.length} mouvement${rows.length > 1 ? 's' : ''} entrant${rows.length > 1 ? 's' : ''} · aucun rapprochement trouvé</p>
      </td></tr>
      <tr><td style="padding:24px 0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Date / canal</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Libellé</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Montant</th></tr>
          ${lignes}
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px;font-size:12px;color:#666;line-height:1.5">
        Cas fréquent : un propriétaire passé de "gestion loyer déléguée à DCB" à "non" (ou l'inverse) après que ses réservations aient déjà été synchronisées — le virement Airbnb/Booking arrive alors sans réservation à laquelle se rattacher. Vérifier dans Facturation → Contrôle virements propriétaires, ou relancer une synchro/ventilation du bien concerné.
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement chaque matin tant qu'un mouvement reste non identifié — s'arrête dès rapprochement.
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

  const { data: mouvements, error } = await supabase
    .from('mouvement_bancaire')
    .select('id, date_operation, libelle, detail, credit, canal, source')
    .eq('agence', AGENCE)
    .eq('statut_matching', 'non_identifie')
    .in('canal', CANAUX_OTA)
    .gt('credit', SEUIL_CTS)
    .order('date_operation')
  if (error) return json({ error: error.message }, 500)

  if (!mouvements?.length) return json({ ok: true, agence: AGENCE, total: 0 })

  const rows = mouvements.map(m => ({
    date: fmtDate(m.date_operation),
    libelle: m.libelle || m.detail || '—',
    canal: m.canal,
    montant: fmtEur(m.credit),
  }))

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `⚠ ${mouvements.length} virement${mouvements.length > 1 ? 's' : ''} OTA sans réservation associée`,
        html: htmlRecap(rows),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'rapprochement', action: 'alerte_virement_orphelin', source: 'cron', statut: 'ok',
      message: `${mouvements.length} virement(s) OTA non identifié(s) (agence ${AGENCE}), alerte envoyée à ${to}`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: mouvements.length, rows })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
