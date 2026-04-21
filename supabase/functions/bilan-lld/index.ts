/**
 * bilan-lld — Edge Function Supabase
 *
 * Génère le PDF bilan mensuel des locations longues durée :
 *   - Tableau loyers (reçus / manquants)
 *   - Tableau virements propriétaires
 *   - Solde du mois
 *
 * Input : { mois: "YYYY-MM", agence?: string, email_destinataire?: string }
 * Output : { ok: true, pdf_url: string, email_envoye: boolean }
 *
 * Variables d'env requises :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto Supabase)
 *   APP_URL  (URL Vercel de l'app — pour appel api/generate-pdf)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function nomMois(mois: string): string {
  const [annee, m] = mois.split('-')
  const noms = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  return `${noms[parseInt(m) - 1]} ${annee}`
}

function formatEuros(centimes: number): string {
  return (centimes / 100).toFixed(2).replace('.', ',') + ' €'
}

function statutLoyerLabel(statut: string): string {
  return { attendu: 'Attendu', recu: 'Reçu ✓', en_retard: 'En retard', exonere: 'Exonéré' }[statut] || statut
}

function statutLoyerColor(statut: string): string {
  return { attendu: '#B45309', recu: '#059669', en_retard: '#DC2626', exonere: '#6B7280' }[statut] || '#333'
}

function genHTML(mois: string, loyers: any[], virements: any[], agenceLabel: string): string {
  const totalRecu = loyers.filter(l => l.statut === 'recu').reduce((s, l) => s + (l.montant_recu || 0), 0)
  const totalVire = virements.filter(v => v.statut === 'vire').reduce((s, v) => s + (v.montant || 0), 0)
  const solde = totalRecu - totalVire

  const rowsLoyers = loyers.map(l => {
    const e = l.etudiant
    const total = e ? (e.loyer_nu||0)+(e.supplement_loyer||0)+(e.charges_eau||0)+(e.charges_copro||0)+(e.charges_internet||0) : 0
    return `
      <tr>
        <td>${e ? `${e.nom}${e.prenom ? ' '+e.prenom : ''}` : '—'}</td>
        <td>${e?.bien?.code || '—'}</td>
        <td style="text-align:right">${formatEuros(total)}</td>
        <td style="color:${statutLoyerColor(l.statut)};font-weight:600">${statutLoyerLabel(l.statut)}</td>
        <td>${l.date_reception || '—'}</td>
        <td style="text-align:right;font-weight:600">${l.montant_recu ? formatEuros(l.montant_recu) : '—'}</td>
      </tr>`
  }).join('')

  const rowsVirements = virements.map(v => {
    const e = v.etudiant
    const proprio = e?.proprietaire ? `${e.proprietaire.nom}${e.proprietaire.prenom ? ' '+e.proprietaire.prenom : ''}` : '—'
    return `
      <tr>
        <td>${e ? `${e.nom}${e.prenom ? ' '+e.prenom : ''}` : '—'}</td>
        <td>${proprio}</td>
        <td style="text-align:right;font-weight:600">${v.montant ? formatEuros(v.montant) : '—'}</td>
        <td style="color:${v.statut === 'vire' ? '#059669' : '#B45309'};font-weight:600">
          ${v.statut === 'vire' ? 'Viré ✓' : 'À virer'}
        </td>
        <td>${v.date_virement || '—'}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #2C2416; margin: 40px; }
  h1 { font-size: 20px; color: #CC9933; margin: 0 0 4px; }
  .subtitle { color: #888; margin-bottom: 30px; font-size: 12px; }
  h2 { font-size: 14px; font-weight: 700; margin: 28px 0 10px; border-bottom: 2px solid #D9CEB8; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th { background: #F7F3EC; padding: 7px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
  td { padding: 7px 10px; border-bottom: 1px solid #EAE3D4; font-size: 12px; }
  .solde { margin-top: 24px; padding: 14px 18px; border-radius: 8px; display: flex; gap: 30px; align-items: center; }
  .solde-ok { background: #D1FAE5; }
  .solde-ko { background: #FEE2E2; }
  .solde-label { font-weight: 700; font-size: 15px; }
  .footer { margin-top: 40px; font-size: 11px; color: #AAA; border-top: 1px solid #EAE3D4; padding-top: 12px; }
</style>
</head>
<body>
  <h1>${agenceLabel} — Bilan locations longues durée</h1>
  <div class="subtitle">${nomMois(mois)} · Généré le ${new Date().toLocaleDateString('fr-FR')}</div>

  <h2>Loyers</h2>
  <table>
    <thead><tr>
      <th>Étudiant</th><th>Bien</th><th style="text-align:right">Attendu</th>
      <th>Statut</th><th>Date réception</th><th style="text-align:right">Reçu</th>
    </tr></thead>
    <tbody>${rowsLoyers}</tbody>
  </table>

  <h2>Virements propriétaires</h2>
  <table>
    <thead><tr>
      <th>Étudiant</th><th>Propriétaire</th><th style="text-align:right">Montant</th>
      <th>Statut</th><th>Date virement</th>
    </tr></thead>
    <tbody>${rowsVirements}</tbody>
  </table>

  <div class="solde ${solde === 0 ? 'solde-ok' : 'solde-ko'}">
    <span class="solde-label" style="color:${solde === 0 ? '#059669' : '#DC2626'}">
      Solde : ${formatEuros(solde)}
    </span>
    <span style="color:#666;font-size:12px">
      Loyers reçus ${formatEuros(totalRecu)} − Virements effectués ${formatEuros(totalVire)}
    </span>
    ${solde === 0 ? '<span style="color:#059669;font-weight:700">✓ Équilibré</span>' : ''}
  </div>

  <div class="footer">
    ${agenceLabel} · Bilan locations longues durée ${nomMois(mois)}
  </div>
</body>
</html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { mois, agence = 'dcb', email_destinataire } = await req.json()
    if (!mois) throw new Error('mois requis')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const APP_URL      = Deno.env.get('APP_URL')!

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    const [{ data: agency }, { data: loyers }, { data: virements }] = await Promise.all([
      supabase.from('agency_config').select('label, resend_from_email, email_comptable').eq('agence', agence).single(),
      supabase.from('loyer_suivi')
        .select('*, etudiant(nom, prenom, loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet, bien(code))')
        .eq('agence', agence).eq('mois', mois).order('created_at'),
      supabase.from('virement_proprio_suivi')
        .select('*, etudiant(nom, prenom, proprietaire(nom, prenom))')
        .eq('agence', agence).eq('mois', mois).order('created_at'),
    ])

    const agenceLabel = agency?.label || 'Destination Côte Basque'
    const html = genHTML(mois, loyers || [], virements || [], agenceLabel)

    // Générer le PDF via Puppeteer
    const pdfRes = await fetch(`${APP_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    })
    if (!pdfRes.ok) throw new Error(`generate-pdf error: ${await pdfRes.text()}`)
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())

    // Uploader en Storage
    const storagePath = `bilans/${agence}-${mois}.pdf`
    await supabase.storage.from('etudiant-documents')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true })

    const { data: { signedUrl } } = await supabase.storage
      .from('etudiant-documents').createSignedUrl(storagePath, 3600)

    // Envoyer par email (supporte plusieurs destinataires séparés par virgule)
    const destRaw = email_destinataire || agency?.email_comptable
    const destinataires = destRaw ? destRaw.split(',').map((e: string) => e.trim()).filter(Boolean) : []
    let email_envoye = false
    if (destinataires.length > 0) {
      let b64 = ''
      for (let i = 0; i < pdfBytes.length; i += 3072) {
        b64 += btoa(String.fromCharCode(...pdfBytes.slice(i, i + 3072)))
      }
      const envois = await Promise.all(destinataires.map(to =>
        fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            to,
            subject: `Bilan LLD ${agenceLabel} — ${mois}`,
            html: `<p>Bonjour,</p><p>Veuillez trouver en pièce jointe le bilan des locations longues durée pour <strong>${nomMois(mois)}</strong>.</p><p>Cordialement,<br>${agenceLabel}</p>`,
            attachment_base64: b64,
            attachment_name: `bilan-lld-${mois}.pdf`,
          }),
        })
      ))
      email_envoye = envois.every(r => r.ok)
    }

    return new Response(
      JSON.stringify({ ok: true, pdf_url: signedUrl, email_envoye }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
