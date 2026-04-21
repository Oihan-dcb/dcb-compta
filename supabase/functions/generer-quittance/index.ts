/**
 * generer-quittance — Edge Function Supabase
 *
 * Génère et envoie la quittance de loyer à un étudiant.
 *
 * Flux :
 *   loyer_suivi_id → fetch DB → HTML quittance → api/generate-pdf (Vercel)
 *   → Supabase Storage → smtp-send (Resend) → update loyer_suivi
 *
 * Déclenchement :
 *   - Manuel depuis PageLocationsLongues (bouton "Envoyer quittance")
 *   - Automatique via trigger DB quand loyer_suivi.statut passe à 'recu'
 *
 * Variables d'env requises :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto Supabase)
 *   APP_URL  — URL Vercel de l'app (ex: https://dcb-compta.vercel.app)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatEuros(euros: number): string {
  return euros.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

function nomMois(mois: string): string {
  const [y, m] = mois.split('-')
  const noms = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  return `${noms[parseInt(m) - 1]} ${y}`
}

function dernierJourMois(mois: string): string {
  const [y, m] = mois.split('-').map(Number)
  return new Date(y, m, 0).getDate().toString()
}

// ── HTML quittance (légal FR) ─────────────────────────────────────────────

function genererHtmlQuittance(data: {
  etudiant: any,
  loyer: any,
  mois: string,
  agence_label: string,
  agence_adresse1?: string,
  agence_adresse2?: string,
  agence_siret?: string,
  charges_nature?: string,
}): string {
  const { etudiant: e, loyer: l, mois, agence_label,
          agence_adresse1, agence_adresse2, agence_siret,
          charges_nature = 'forfaitaires' } = data
  const total = (e.loyer_nu || 0) + (e.supplement_loyer || 0) +
                (e.charges_eau || 0) + (e.charges_copro || 0) + (e.charges_internet || 0)
  const dateReception = l.date_reception ? formatDate(l.date_reception) : formatDate(new Date().toISOString().slice(0, 10))
  const premierJour = `1er ${nomMois(mois)}`
  const dernierJour = `${dernierJourMois(mois)} ${nomMois(mois)}`
  const locataire = `${e.prenom ? e.prenom + ' ' : ''}${e.nom}`

  const lignesCharges = []
  if (e.supplement_loyer > 0) lignesCharges.push(`<tr><td style="padding:3px 0;color:#555">Supplément de loyer</td><td style="text-align:right;padding:3px 0">${formatEuros(e.supplement_loyer)}</td></tr>`)
  if (e.charges_eau > 0) lignesCharges.push(`<tr><td style="padding:3px 0;color:#555">Eau</td><td style="text-align:right;padding:3px 0">${formatEuros(e.charges_eau)}</td></tr>`)
  if (e.charges_copro > 0) lignesCharges.push(`<tr><td style="padding:3px 0;color:#555">Copropriété</td><td style="text-align:right;padding:3px 0">${formatEuros(e.charges_copro)}</td></tr>`)
  if (e.charges_internet > 0) lignesCharges.push(`<tr><td style="padding:3px 0;color:#555">Internet</td><td style="text-align:right;padding:3px 0">${formatEuros(e.charges_internet)}</td></tr>`)

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #2C2416; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid #CC9933; padding-bottom: 20px; }
  .logo { font-size: 22px; font-weight: 800; color: #CC9933; letter-spacing: 1px; }
  .logo span { color: #2C2416; font-weight: 400; font-size: 14px; display: block; margin-top: 2px; }
  .titre { font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 28px; text-transform: uppercase; letter-spacing: 2px; color: #2C2416; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .bloc { background: #F7F3EC; border: 1px solid #D9CEB8; border-radius: 6px; padding: 14px 16px; }
  .bloc-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #8C7B65; margin-bottom: 6px; }
  .bloc-value { font-size: 13px; font-weight: 600; color: #2C2416; line-height: 1.5; }
  .periode { text-align: center; background: #F7F3EC; border: 1px solid #D9CEB8; border-radius: 6px; padding: 10px; margin-bottom: 28px; font-size: 13px; color: #555; }
  table.detail { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  table.detail td { padding: 6px 0; }
  .separator { border: none; border-top: 1px solid #D9CEB8; margin: 6px 0; }
  .total-row td { font-weight: 700; font-size: 15px; padding-top: 10px; }
  .recu { background: #D1FAE5; border: 1px solid #6EE7B7; border-radius: 6px; padding: 12px 16px; margin: 24px 0; text-align: center; font-weight: 700; color: #065F46; font-size: 14px; }
  .mention { font-size: 11px; color: #8C7B65; text-align: center; margin-top: 24px; line-height: 1.6; }
  .footer { margin-top: 40px; border-top: 1px solid #D9CEB8; padding-top: 16px; display: flex; justify-content: space-between; font-size: 11px; color: #8C7B65; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="logo">DCB <span>${agence_label}</span></div>
  </div>
  <div style="text-align:right;font-size:11px;color:#8C7B65">
    Quittance n° ${mois}-${e.id.slice(0, 8).toUpperCase()}<br>
    Émise le ${formatDate(new Date().toISOString().slice(0, 10))}
  </div>
</div>

<div class="titre">Quittance de loyer</div>

<div class="parties">
  <div class="bloc">
    <div class="bloc-label">Bailleur (mandataire)</div>
    <div class="bloc-value">
      ${agence_label}<br>
      ${agence_adresse1 ? `<span style="font-weight:400;color:#555">${agence_adresse1}</span><br>` : ''}
      ${agence_adresse2 ? `<span style="font-weight:400;color:#555">${agence_adresse2}</span>` : ''}
      ${agence_siret ? `<br><span style="font-weight:400;color:#555;font-size:11px">SIRET ${agence_siret}</span>` : ''}
    </div>
  </div>
  <div class="bloc">
    <div class="bloc-label">Locataire</div>
    <div class="bloc-value">${locataire}</div>
  </div>
</div>

<div class="bloc" style="margin-bottom:20px">
  <div class="bloc-label">Logement</div>
  <div class="bloc-value">${e.adresse_complete || '— adresse non renseignée —'}</div>
</div>

<div class="periode">
  Période : du <strong>${premierJour}</strong> au <strong>${dernierJour}</strong>
</div>

<table class="detail">
  <tbody>
    <tr>
      <td style="padding:6px 0">Loyer hors charges</td>
      <td style="text-align:right;padding:6px 0;font-weight:600">${formatEuros(e.loyer_nu)}</td>
    </tr>
    ${lignesCharges.join('\n    ')}
    <tr><td colspan="2"><hr class="separator"></td></tr>
    <tr class="total-row">
      <td>Total mensuel (dont charges ${charges_nature})</td>
      <td style="text-align:right;color:#CC9933">${formatEuros(total)}</td>
    </tr>
  </tbody>
</table>

<div class="recu">
  ✓ Reçu le ${dateReception} la somme de ${formatEuros(l.montant_recu || total)}
</div>

<div class="mention">
  Je soussigné(e), représentant(e) de ${agence_label}, mandataire du bailleur,<br>
  déclare avoir reçu de ${locataire} la somme de <strong>${formatEuros(l.montant_recu || total)}</strong><br>
  au titre du loyer (${formatEuros(e.loyer_nu)}) et des charges ${charges_nature} (${formatEuros(total - (e.loyer_nu || 0))})<br>
  pour la période indiquée ci-dessus, conformément à l'article 21 de la loi n° 89-462 du 6 juillet 1989.<br><br>
  <strong>Cette quittance annule tous les reçus qui auraient pu être établis précédemment en règlement du loyer du même mois.</strong>
</div>

<div class="footer">
  <span>${agence_label}</span>
  <span>Document généré automatiquement</span>
</div>

</body>
</html>`
}

// ── Main ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { loyer_suivi_id, envoyer_email = true } = await req.json()

    if (!loyer_suivi_id) {
      return new Response(
        JSON.stringify({ error: 'loyer_suivi_id requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const APP_URL      = Deno.env.get('APP_URL') || 'https://dcb-compta.vercel.app'

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // ── 1. Fetch loyer_suivi + étudiant ──────────────────────────────────
    const { data: loyer, error: errLoyer } = await supabase
      .from('loyer_suivi')
      .select(`
        *,
        etudiant (
          id, agence, nom, prenom, email, adresse_complete,
          loyer_nu, supplement_loyer, charges_eau, charges_copro, charges_internet,
          honoraires_dcb
        )
      `)
      .eq('id', loyer_suivi_id)
      .single()

    if (errLoyer || !loyer) {
      return new Response(
        JSON.stringify({ error: errLoyer?.message || 'loyer_suivi introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (loyer.statut !== 'recu') {
      return new Response(
        JSON.stringify({ error: `Loyer statut "${loyer.statut}" — quittance uniquement sur statut "recu"` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const etudiant = loyer.etudiant
    if (!etudiant) {
      return new Response(
        JSON.stringify({ error: 'Étudiant introuvable' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── 2. Label agence ──────────────────────────────────────────────────
    const { data: agenceData } = await supabase
      .from('agency_config')
      .select('label, adresse_ligne1, adresse_ligne2, siret, charges_nature')
      .eq('agence', etudiant.agence)
      .single()
    const agence_label = agenceData?.label || 'Destination Côte Basque'

    // ── 3. Générer HTML ──────────────────────────────────────────────────
    const html = genererHtmlQuittance({
      etudiant,
      loyer,
      mois: loyer.mois,
      agence_label,
      agence_adresse1:  agenceData?.adresse_ligne1 || undefined,
      agence_adresse2:  agenceData?.adresse_ligne2 || undefined,
      agence_siret:     agenceData?.siret || undefined,
      charges_nature:   agenceData?.charges_nature || 'forfaitaires',
    })

    // ── 4. Appel Vercel generate-pdf ─────────────────────────────────────
    const pdfRes = await fetch(`${APP_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, orientation: 'portrait' }),
    })

    if (!pdfRes.ok) {
      const errText = await pdfRes.text()
      return new Response(
        JSON.stringify({ error: `generate-pdf échoué: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const pdfBytes = await pdfRes.arrayBuffer()

    // ── 5. Upload Supabase Storage ───────────────────────────────────────
    const filename = `quittances/${etudiant.id}/${loyer.mois}.pdf`
    const { error: errUpload } = await supabase.storage
      .from('etudiant-documents')
      .upload(filename, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (errUpload) {
      return new Response(
        JSON.stringify({ error: `Upload Storage échoué: ${errUpload.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: { publicUrl } } = supabase.storage
      .from('etudiant-documents')
      .getPublicUrl(filename)

    // ── 6. Envoyer email quittance ───────────────────────────────────────
    if (envoyer_email && etudiant.email) {
      const nomMoisLabel = loyer.mois.split('-').map((v: string, i: number) =>
        i === 1 ? ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][parseInt(v)-1] : v
      ).reverse().join(' ')

      const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)))

      await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          to: etudiant.email,
          subject: `Quittance de loyer — ${nomMoisLabel}`,
          html: `<p>Bonjour ${etudiant.prenom || etudiant.nom},</p>
<p>Veuillez trouver ci-joint votre quittance de loyer pour le mois de <strong>${nomMoisLabel}</strong>.</p>
<p>Cordialement,<br>${agence_label}</p>`,
          attachments: [{
            filename: `quittance-${loyer.mois}.pdf`,
            content_base64: pdfBase64,
          }],
        }),
      })
    }

    // ── 7. Mettre à jour loyer_suivi ─────────────────────────────────────
    const { error: errUpdate } = await supabase
      .from('loyer_suivi')
      .update({
        quittance_pdf_url:    publicUrl,
        quittance_envoyee_at: new Date().toISOString(),
      })
      .eq('id', loyer_suivi_id)

    if (errUpdate) {
      return new Response(
        JSON.stringify({ error: `Update loyer_suivi échoué: ${errUpdate.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        pdf_url:       publicUrl,
        email_envoye:  envoyer_email && !!etudiant.email,
        etudiant_nom:  `${etudiant.prenom || ''} ${etudiant.nom}`.trim(),
        mois:          loyer.mois,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
