/**
 * relance-debours — Edge Function Supabase (cron quotidien 8h UTC via pg_cron)
 *
 * Relance les propriétaires qui n'ont pas confirmé le virement de remboursement
 * des débours AE (facture type 'debours', statut 'envoye_proprio').
 *
 * Cadence :
 *   - Relance 1 : ≥ 5 jours après l'envoi initial (envoye_proprio_at), nb_relances = 0
 *   - Relance 2 : ≥ 5 jours après la relance 1, nb_relances = 1
 *   - Escalade  : ≥ 5 jours après la relance 2 → push Oïhan (PowerHouse + Portail AE),
 *                 nb_relances = 3 (sentinelle : badge rouge UI, plus de relance auto)
 *
 * Emails via smtp-send (Oïhan en CC automatique). Lien de confirmation régénéré
 * (HMAC DEBOURS_CONFIRM_SECRET, 30 jours) — même mécanique que l'email initial.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = Deno.env.get('DEBOURS_CONFIRM_SECRET') ?? ''
const PUSH_SECRET  = Deno.env.get('PORTAIL_CRON_SECRET') ?? ''

const JOURS_ENTRE_RELANCES = 5
const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']

async function confirmUrl(factureId: string): Promise<string | null> {
  if (!SECRET) return null
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${factureId}:${expiry}`))
  const hmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  const token = btoa(`${factureId}:${expiry}:${hmac}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${SUPABASE_URL}/functions/v1/confirm-virement-debours?token=${token}`
}

function htmlRelance(opts: {
  prenom: string; bienNom: string; moisLabel: string; montantEur: string;
  iban: string; bic: string; ref: string; url: string | null; numero: number;
}) {
  const { prenom, bienNom, moisLabel, montantEur, iban, bic, ref, url, numero } = opts
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">Rappel ${numero} — Remboursement débours AE</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${bienNom} · ${moisLabel}</p>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 18px;font-size:15px;color:#2C2416">Bonjour ${prenom},</p>
        <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.7">
          Sauf erreur de notre part, nous n'avons pas encore reçu votre virement de remboursement
          des débours auto-entrepreneur pour <strong style="color:#2C2416">${bienNom}</strong> (${moisLabel}).
        </p>
        <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px"><tr>
          <td style="background:#FBF5E6;border:1.5px solid #CC9933;border-radius:8px;padding:16px 24px;text-align:center">
            <div style="font-size:11px;color:#9C8E7D;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">Montant à rembourser</div>
            <div style="font-size:28px;font-weight:bold;color:#CC9933">${montantEur} €</div>
          </td>
        </tr></table>
        <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;background:#f9f6f0;border-radius:8px"><tr><td style="padding:16px 22px;font-size:13px;color:#2C2416;line-height:2">
          <strong>IBAN (séquestre)</strong> : <span style="font-family:'Courier New',monospace">${iban}</span><br>
          <strong>BIC</strong> : <span style="font-family:'Courier New',monospace">${bic}</span><br>
          <strong>Référence</strong> : <span style="font-family:'Courier New',monospace">${ref}</span>
        </td></tr></table>
        ${url ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px"><tr><td align="center">
          <a href="${url}" style="display:inline-block;background:#CC9933;color:#fff;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 32px;border-radius:8px">✓ J'ai effectué le virement</a>
        </td></tr></table>
        <p style="margin:0 0 0;font-size:12px;color:#9C8E7D;text-align:center">Un clic suffit — cela met à jour notre suivi et stoppe les rappels.</p>` : ''}
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Si votre virement est déjà parti, merci de cliquer sur le bouton ci-dessus — les délais bancaires peuvent expliquer ce rappel.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true

  const { data: factures, error } = await supabase
    .from('facture_evoliz')
    .select('id, mois, agence, total_ttc, total_ht, nb_relances, envoye_proprio_at, derniere_relance_at, bien:bien_id(code, hospitable_name), proprietaire:proprietaire_id(nom, prenom, email)')
    .eq('type_facture', 'debours')
    .eq('statut', 'envoye_proprio')
  if (error) return json({ error: error.message }, 500)

  const now = Date.now()
  const results: unknown[] = []

  for (const f of factures || []) {
    const nb = f.nb_relances || 0
    const refDate = f.derniere_relance_at || f.envoye_proprio_at
    if (!refDate || nb >= 3) { results.push({ id: f.id, action: 'skip', nb }); continue }
    const jours = (now - new Date(refDate).getTime()) / 86400000
    if (jours < JOURS_ENTRE_RELANCES) { results.push({ id: f.id, action: 'attente', nb, jours: Math.floor(jours) }); continue }

    // Re-vérification juste avant l'envoi : la liste `factures` est une PHOTO prise au début
    // du cron — si le propriétaire a confirmé le virement entre-temps (le cron traite parfois
    // des dizaines de factures, ça prend du temps), on ne veut SURTOUT PAS lui envoyer une
    // relance obsolète. Incident du 15/07/2026 : relances reçues après confirmation.
    if (!dryRun) {
      const { data: fresh } = await supabase.from('facture_evoliz').select('statut').eq('id', f.id).maybeSingle()
      if (fresh?.statut !== 'envoye_proprio') { results.push({ id: f.id, action: 'skip_deja_confirme_entretemps' }); continue }
    }

    const bienNom = f.bien?.code || f.proprietaire?.nom || 'votre bien'
    const [y, m] = (f.mois || '').split('-')
    const moisLabel = `${MOIS_FR[parseInt(m) - 1] || f.mois} ${y}`
    const montantEur = ((f.total_ttc || f.total_ht || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })

    if (nb >= 2) {
      // Escalade : push Oïhan, plus de relance auto
      if (!dryRun) {
        if (PUSH_SECRET) {
          const { data: oihan } = await supabase.from('auto_entrepreneur')
            .select('ae_user_id').eq('nom', 'CAMPANDEGUI').ilike('prenom', 'oihan%').maybeSingle()
          if (oihan?.ae_user_id) {
            await fetch('https://staff-app.destinationcotebasque.com/api/push-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PUSH_SECRET}` },
              body: JSON.stringify({
                user_id: oihan.ae_user_id,
                title: '⚠ Débours sans réponse',
                body: `${f.proprietaire?.nom || '?'} — débours ${bienNom} ${f.mois} (${montantEur} €) toujours pas confirmé après 2 relances`,
              }),
            }).catch(() => {})
          }
        }
        await supabase.from('facture_evoliz').update({ nb_relances: 3, derniere_relance_at: new Date().toISOString() }).eq('id', f.id).eq('statut', 'envoye_proprio')
        await supabase.from('journal_ops').insert({
          categorie: 'facturation', action: 'relance_debours_escalade', source: 'cron', statut: 'ok',
          mois_comptable: f.mois, message: `Débours ${bienNom} ${f.mois} : escalade Oïhan après 2 relances sans confirmation (${montantEur} €)`,
        })
      }
      results.push({ id: f.id, bien: bienNom, action: 'escalade' })
      continue
    }

    // Relance email
    if (!f.proprietaire?.email) { results.push({ id: f.id, action: 'skip_no_email' }); continue }
    const { data: billing } = await supabase.from('agency_config')
      .select('seq_lc_iban, seq_lc_bic').eq('agence', f.agence || 'dcb').single()
    const ref = `DEBOURS-AE-${bienNom.replace(/[^A-Z0-9]/gi, '-').toUpperCase()}-${f.mois}`
    const url = await confirmUrl(f.id)
    const numero = nb + 1
    const html = htmlRelance({
      prenom: f.proprietaire.prenom || f.proprietaire.nom, bienNom, moisLabel, montantEur,
      iban: billing?.seq_lc_iban || '', bic: billing?.seq_lc_bic || '', ref, url, numero,
    })

    if (!dryRun) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          to: [f.proprietaire.email],
          subject: `Rappel ${numero} — Remboursement débours AE — ${moisLabel} — ${bienNom}`,
          html,
        }),
      })
      if (!res.ok) { results.push({ id: f.id, action: 'erreur_smtp', detail: await res.text() }); continue }
      await supabase.from('facture_evoliz').update({ nb_relances: numero, derniere_relance_at: new Date().toISOString() }).eq('id', f.id).eq('statut', 'envoye_proprio')
      await supabase.from('journal_ops').insert({
        categorie: 'facturation', action: 'relance_debours', source: 'cron', statut: 'ok',
        mois_comptable: f.mois, message: `Relance ${numero} débours ${bienNom} ${f.mois} envoyée à ${f.proprietaire.email} (${montantEur} €)`,
      })
    }
    results.push({ id: f.id, bien: bienNom, action: `relance_${numero}` })
  }

  return json({ dry_run: dryRun, total: (factures || []).length, results })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
