/**
 * Edge Function — Confirmation virement débours propriétaire
 * GET /confirm-virement-debours?token=<signed_token>
 *
 * Le token = base64url( factureId:expiry:hmac-sha256 )
 * Signé côté client avec DEBOURS_CONFIRM_SECRET (même secret dans facturesEvoliz.js via env)
 * Valide 30 jours.
 *
 * À l'appel :
 *  1. Vérifie la signature HMAC
 *  2. Vérifie l'expiration
 *  3. Met à jour facture_evoliz.statut = 'remboursement_recu'
 *  4. Retourne une page HTML de confirmation
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = Deno.env.get('DEBOURS_CONFIRM_SECRET') ?? ''

function htmlPage(titre: string, message: string, isError = false) {
  const color = isError ? '#DC2626' : '#CC9933'
  const icon  = isError ? '⚠' : '✓'
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titre} — Destination Côte Basque</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center">
  <div style="background:#fff;border-radius:10px;padding:48px 40px;max-width:480px;width:90%;text-align:center;box-shadow:0 2px 16px rgba(44,36,22,0.10)">
    <div style="font-size:48px;margin-bottom:20px">${icon}</div>
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9C8E7D;margin-bottom:12px">Destination Côte Basque</div>
    <h1 style="margin:0 0 16px;font-size:22px;color:${color};font-weight:bold">${titre}</h1>
    <p style="margin:0 0 32px;font-size:14px;color:#666;line-height:1.6">${message}</p>
    <div style="border-top:2px solid ${color};padding-top:20px;font-size:11px;color:#9C8E7D">
      Destination Côte Basque SARL · RCS Bayonne 904 781 671
    </div>
  </div>
</body></html>`
}

async function verifyToken(token: string): Promise<{ factureId: string } | null> {
  try {
    // Décoder base64url
    const decoded = atob(token.replace(/-/g, '+').replace(/_/g, '/'))
    const [factureId, expiry, receivedHmac] = decoded.split(':')
    if (!factureId || !expiry || !receivedHmac) return null

    // Vérifier expiration
    if (Date.now() > parseInt(expiry)) return null

    // Recalculer HMAC
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${factureId}:${expiry}`))
    const expectedHmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

    if (expectedHmac !== receivedHmac) return null
    return { factureId }
  } catch {
    return null
  }
}

serve(async (req) => {
  const url    = new URL(req.url)
  const token  = url.searchParams.get('token')

  if (!token) {
    return new Response(
      htmlPage('Lien invalide', 'Ce lien de confirmation est invalide ou incomplet.', true),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  if (!SECRET) {
    return new Response(
      htmlPage('Erreur configuration', 'DEBOURS_CONFIRM_SECRET non configuré.', true),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const verified = await verifyToken(token)
  if (!verified) {
    return new Response(
      htmlPage('Lien expiré', 'Ce lien de confirmation a expiré ou est invalide. Contactez Oïhan si vous avez effectué le virement.', true),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Vérifier l'état actuel
  const { data: facture } = await supabase
    .from('facture_evoliz')
    .select('id, statut, mois')
    .eq('id', verified.factureId)
    .maybeSingle()

  if (!facture) {
    return new Response(
      htmlPage('Facture introuvable', 'Ce lien ne correspond à aucune facture. Contactez Oïhan.', true),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // Déjà confirmé
  if (facture.statut === 'remboursement_recu') {
    return new Response(
      htmlPage('Déjà confirmé', 'Ce virement a déjà été enregistré. Merci.'),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // Mettre à jour
  const { error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'remboursement_recu' })
    .eq('id', verified.factureId)
    .eq('statut', 'envoye_proprio')

  if (error) {
    return new Response(
      htmlPage('Erreur', `Impossible de confirmer : ${error.message}`, true),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  return new Response(
    htmlPage(
      'Virement confirmé',
      `Merci — votre virement pour le mois de <strong>${facture.mois}</strong> a bien été enregistré. Destination Côte Basque en a été informée.`
    ),
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
})
