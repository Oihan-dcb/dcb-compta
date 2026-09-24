/**
 * alerte-fraicheur-banque — Edge Function Supabase (cron quotidien 8h49 UTC via pg_cron)
 *
 * Garde-fou I-152 (audit segment Banque, 24/09/2026) : la connexion bancaire Pennylane du compte
 * CAISSE EPARGNE COURANT est tombée côté Pennylane (dernière transaction le 10/07/2026) et
 * PERSONNE ne l'a vu pendant 2 mois et demi — le cron affichait « 196 importées » chaque nuit
 * (compteur faux, corrigé dans importBanque.js). Conséquences : paiements d'honoraires/débours des
 * propriétaires jamais rapprochés, relances envoyées à des propriétaires qui avaient payé.
 *
 * Ce contrôle regarde, pour chaque compte suivi, la date de la DERNIÈRE opération en base et
 * alerte si elle dépasse le seuil. Mail répété chaque matin tant que le compte reste muet :
 * voulu pour une panne de flux. Lecture seule (seule écriture : journal_ops).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DESTINATAIRE = 'oihan@destinationcotebasque.com'

// Comptes suivis. Seuil en jours calendaires (week-end compris : 4 j absorbe un pont).
const COMPTES = [
  { source: 'Pennylane_LOCATION_SAISONNIERE', agence: 'dcb',    label: 'Séquestre location saisonnière (Pennylane)', jours: 4,
    action: 'Pennylane → Banque → CAISSE EPARGNE LOCATIONS SAISONNIERES : reconnecter la banque si la synchronisation est interrompue.' },
  { source: 'Powens_courant',                agence: 'dcb',    label: 'Compte courant DCB (Pennylane)',            jours: 5,
    action: 'Pennylane → Banque → CAISSE EPARGNE COURANT : reconnecter la banque (consentement DSP2 expiré, à renouveler tous les 180 jours).' },
  { source: 'CaisseEpargne',                 agence: 'lauian', label: 'Lauïan — Caisse d\'Épargne (import CSV manuel)', jours: 10,
    action: 'dcb-compta Lauïan → Banque : importer le dernier relevé CSV Caisse d\'Épargne.' },
]

function joursDepuis(iso: string) {
  return Math.floor((Date.now() - new Date(iso + 'T12:00:00Z').getTime()) / 86400000)
}
function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true

  const etat = []
  for (const c of COMPTES) {
    const { data, error } = await supabase.from('mouvement_bancaire')
      .select('date_operation').eq('source', c.source).eq('agence', c.agence)
      .order('date_operation', { ascending: false }).limit(1)
    if (error) return json({ error: error.message }, 500)
    const derniere = data?.[0]?.date_operation ?? null
    const age = derniere ? joursDepuis(derniere) : null
    etat.push({ ...c, derniere, age, muet: age == null || age > c.jours })
  }
  const muets = etat.filter(e => e.muet)
  if (!muets.length) return json({ ok: true, muets: 0, etat })

  const td = 'padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416;vertical-align:top'
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:680px;width:100%">
      <tr><td style="background:#C0392B;padding:24px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Relevé bancaire muet</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px">${muets.length} compte${muets.length > 1 ? 's' : ''} sans nouvelle opération importée</p>
      </td></tr>
      <tr><td style="padding:10px 0 0"><table width="100%" cellpadding="0" cellspacing="0">
        ${muets.map(m => `<tr><td style="${td}"><strong>${m.label}</strong><br><span style="color:#9C8E7D;font-size:11px">dernière opération : ${m.derniere ? fmtDate(m.derniere) + ` (il y a ${m.age} j, seuil ${m.jours} j)` : 'aucune'}</span></td>
          <td style="${td};font-size:12px;color:#666">${m.action}</td></tr>`).join('')}
      </table></td></tr>
      <tr><td style="padding:16px 40px;font-size:12px;color:#666;line-height:1.5">
        Tant qu'un compte n'est plus alimenté, rien de ce qui y passe n'est rapproché : paiements des
        propriétaires, reversements, débours — et les relances automatiques peuvent partir à tort.
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:14px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Contrôle quotidien — ce mail revient chaque matin tant qu'un compte reste muet.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: [DESTINATAIRE], subject: `⚠ Relevé bancaire muet : ${muets.map(m => m.label).join(', ')}`, html }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'banque', action: 'alerte_fraicheur_banque', source: 'cron', statut: 'warning',
      message: `${muets.length} compte(s) muet(s) : ${muets.map(m => `${m.label} (dernière op. ${m.derniere ?? 'aucune'})`).join(' ; ')}`,
    })
  }
  return json({ dry_run: dryRun, muets: muets.length, etat })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
