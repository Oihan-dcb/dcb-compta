/**
 * relance-facture-impayee — Edge Function Supabase (cron quotidien)
 *
 * Relance les propriétaires dont une facture (honoraires ou débours) a été
 * envoyée à Evoliz (statut 'envoye_evoliz') mais reste réellement impayée.
 *
 * IMPORTANT : dépend de sync-evoliz-statut (doit tourner AVANT ce cron) —
 * sans elle, statut='envoye_evoliz' ne reflète pas la réalité (facture_evoliz
 * n'est jamais mis à jour tout seul après l'envoi, bug constaté 2026-08-05).
 * Ne touche jamais les factures jamais envoyées (statut 'brouillon'/
 * 'calcul_en_cours') — hors périmètre, cf. demande explicite.
 *
 * Cadence (plus rapprochée que relance-debours vu les montants en jeu) :
 *   - Relance 1 : ≥ 3 jours après date_emission, nb_relances = 0
 *   - Relance 2 : ≥ 3 jours après la relance 1, nb_relances = 1
 *   - Escalade  : ≥ 3 jours après la relance 2 → push Oïhan, nb_relances = 3
 *                 (sentinelle : plus de relance auto, badge UI à traiter)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PUSH_SECRET  = Deno.env.get('PORTAIL_CRON_SECRET') ?? ''

const JOURS_ENTRE_RELANCES = 3
const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']

const TYPE_LABEL: Record<string, string> = { honoraires: "d'honoraires de gestion", debours: 'de débours' }

function htmlRelance(opts: {
  prenom: string; bienNom: string; moisLabel: string; montantEur: string;
  typeLabel: string; numero: number; agenceLabel: string;
}) {
  const { prenom, bienNom, moisLabel, montantEur, typeLabel, numero, agenceLabel } = opts
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:600px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">${agenceLabel}</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">Rappel ${numero} — Facture ${typeLabel}</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${bienNom} · ${moisLabel}</p>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 18px;font-size:15px;color:#2C2416">Bonjour ${prenom},</p>
        <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.7">
          Sauf erreur de notre part, nous n'avons pas encore reçu le règlement de votre facture ${typeLabel}
          pour <strong style="color:#2C2416">${bienNom}</strong> (${moisLabel}).
        </p>
        <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px"><tr>
          <td style="background:#FBF5E6;border:1.5px solid #CC9933;border-radius:8px;padding:16px 24px;text-align:center">
            <div style="font-size:11px;color:#9C8E7D;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">Montant dû</div>
            <div style="font-size:28px;font-weight:bold;color:#CC9933">${montantEur} €</div>
          </td>
        </tr></table>
        <p style="margin:0;font-size:13px;color:#666;line-height:1.6">Merci de bien vouloir régulariser dès que possible sur le compte habituel.</p>
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Si votre virement est déjà parti, merci d'ignorer ce message.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* cron sans body */ }
  const dryRun = body.dry_run === true

  const { data: factures, error } = await supabase
    .from('facture_evoliz')
    .select('id, mois, agence, type_facture, total_ttc, total_ht, nb_relances, date_emission, derniere_relance_at, bien:bien_id(code, hospitable_name), proprietaire:proprietaire_id(nom, prenom, email)')
    .in('type_facture', ['honoraires', 'debours'])
    .eq('statut', 'envoye_evoliz')
  if (error) return json({ error: error.message }, 500)

  const now = Date.now()
  const results: unknown[] = []

  for (const f of factures || []) {
    const nb = f.nb_relances || 0
    const refDate = f.derniere_relance_at || f.date_emission
    if (!refDate || nb >= 3) { results.push({ id: f.id, action: 'skip', nb }); continue }
    const jours = (now - new Date(refDate).getTime()) / 86400000
    if (jours < JOURS_ENTRE_RELANCES) { results.push({ id: f.id, action: 'attente', nb, jours: Math.floor(jours) }); continue }

    // Re-vérification juste avant l'envoi : la synchro Evoliz (ou un paiement
    // reçu entre-temps) peut avoir changé le statut depuis le début du cron.
    if (!dryRun) {
      const { data: fresh } = await supabase.from('facture_evoliz').select('statut').eq('id', f.id).maybeSingle()
      if (fresh?.statut !== 'envoye_evoliz') { results.push({ id: f.id, action: 'skip_deja_paye_entretemps' }); continue }
    }

    const bienNom = f.bien?.code || f.bien?.hospitable_name || f.proprietaire?.nom || 'votre bien'
    const [y, m] = (f.mois || '').split('-')
    const moisLabel = `${MOIS_FR[parseInt(m) - 1] || f.mois} ${y}`
    const montantEur = ((f.total_ttc || f.total_ht || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
    const typeLabel = TYPE_LABEL[f.type_facture] || 'de gestion'

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
                title: '⚠ Facture impayée sans réponse',
                body: `${f.proprietaire?.nom || '?'} — facture ${f.type_facture} ${bienNom} ${f.mois} (${montantEur} €) toujours impayée après 2 relances`,
              }),
            }).catch(() => {})
          }
        }
        await supabase.from('facture_evoliz').update({ nb_relances: 3, derniere_relance_at: new Date().toISOString() }).eq('id', f.id).eq('statut', 'envoye_evoliz')
        await supabase.from('journal_ops').insert({
          categorie: 'facturation', action: 'relance_facture_escalade', source: 'cron', statut: 'ok',
          mois_comptable: f.mois, message: `Facture ${f.type_facture} ${bienNom} ${f.mois} : escalade Oïhan après 2 relances sans paiement (${montantEur} €)`,
        })
      }
      results.push({ id: f.id, bien: bienNom, action: 'escalade' })
      continue
    }

    // Relance email
    if (!f.proprietaire?.email) { results.push({ id: f.id, action: 'skip_no_email' }); continue }
    const { data: agenceData } = await supabase.from('agency_config').select('label').eq('agence', f.agence || 'dcb').single()
    const agenceLabel = agenceData?.label || 'Destination Côte Basque'
    const numero = nb + 1
    const html = htmlRelance({
      prenom: f.proprietaire.prenom || f.proprietaire.nom, bienNom, moisLabel, montantEur, typeLabel, numero, agenceLabel,
    })

    if (!dryRun) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          to: [f.proprietaire.email],
          subject: `Rappel ${numero} — Facture ${typeLabel} — ${moisLabel} — ${bienNom}`,
          html,
        }),
      })
      if (!res.ok) { results.push({ id: f.id, action: 'erreur_smtp', detail: await res.text() }); continue }
      await supabase.from('facture_evoliz').update({ nb_relances: numero, derniere_relance_at: new Date().toISOString() }).eq('id', f.id).eq('statut', 'envoye_evoliz')
      await supabase.from('journal_ops').insert({
        categorie: 'facturation', action: 'relance_facture', source: 'cron', statut: 'ok',
        mois_comptable: f.mois, message: `Relance ${numero} facture ${f.type_facture} ${bienNom} ${f.mois} envoyée à ${f.proprietaire.email} (${montantEur} €)`,
      })
    }
    results.push({ id: f.id, bien: bienNom, action: `relance_${numero}` })
  }

  return json({ dry_run: dryRun, total: (factures || []).length, results })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
