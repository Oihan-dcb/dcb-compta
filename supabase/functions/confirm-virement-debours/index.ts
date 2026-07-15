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
 *  4. Redirige vers une page publique de confirmation
 *
 * ⚠ DÉPLOIEMENT : cette fonction DOIT être déployée avec verify_jwt=false
 *   (lien public cliqué depuis un email, sans JWT ; auth custom par token HMAC).
 *   Sinon la passerelle Supabase renvoie 401 avant d'exécuter le handler.
 *   → `supabase functions deploy confirm-virement-debours --no-verify-jwt`
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = Deno.env.get('DEBOURS_CONFIRM_SECRET') ?? ''

const CONFIRM_PAGE_URL = Deno.env.get('DEBOURS_CONFIRM_PAGE_URL') ?? 'https://dcb-compta.vercel.app/debours-confirmation.html'

function confirmationRedirect(status: string) {
  const target = new URL(CONFIRM_PAGE_URL)
  target.searchParams.set('status', status)
  return Response.redirect(target.toString(), 303)
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
    return confirmationRedirect('invalid')
  }

  if (!SECRET) {
    return confirmationRedirect('config')
  }

  const verified = await verifyToken(token)
  if (!verified) {
    return confirmationRedirect('expired')
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Vérifier l'état actuel
  const { data: facture } = await supabase
    .from('facture_evoliz')
    .select('id, statut, mois, total_ttc, bien:bien_id(code), proprietaire:proprietaire_id(nom, prenom)')
    .eq('id', verified.factureId)
    .maybeSingle()

  if (!facture) {
    return confirmationRedirect('not-found')
  }

  // Déjà confirmé
  if (facture.statut === 'remboursement_recu') {
    return confirmationRedirect('already')
  }

  // Mettre à jour — .select() pour vérifier qu'une ligne a RÉELLEMENT été modifiée.
  // Sans ce contrôle, un update qui touche 0 ligne (ex. statut plus tout à fait
  // 'envoye_proprio' au moment du clic) ne renvoie PAS d'erreur côté PostgREST : la page
  // affichait "confirmé" au propriétaire alors que rien n'avait changé en base, et
  // relance-debours continuait de le relancer (incident du 15/07/2026).
  const { data: updated, error } = await supabase
    .from('facture_evoliz')
    .update({ statut: 'remboursement_recu' })
    .eq('id', verified.factureId)
    .eq('statut', 'envoye_proprio')
    .select('id')

  if (error) {
    return confirmationRedirect('error')
  }
  if (!updated || updated.length === 0) {
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'confirm_debours_noop', source: 'confirm-virement-debours', statut: 'warning',
      mois_comptable: facture.mois,
      message: `Confirmation débours facture ${verified.factureId} : update 0 ligne (statut lu="${facture.statut}", attendu "envoye_proprio") — investiguer.`,
    }).catch(() => {})
    return confirmationRedirect('error')
  }

  // Push Oïhan (PowerHouse + Portail AE — table push_subscriptions partagée). Best-effort.
  try {
    const pushSecret = Deno.env.get('PORTAIL_CRON_SECRET')
    if (pushSecret) {
      const { data: oihan } = await supabase
        .from('auto_entrepreneur')
        .select('ae_user_id')
        .eq('nom', 'CAMPANDEGUI').ilike('prenom', 'oihan%')
        .maybeSingle()
      if (oihan?.ae_user_id) {
        const proprioNom = [facture.proprietaire?.prenom, facture.proprietaire?.nom].filter(Boolean).join(' ') || 'Un propriétaire'
        const bienCode = facture.bien?.code || ''
        const montant = ((facture.total_ttc || 0) / 100).toFixed(2)
        await fetch('https://staff-app.destinationcotebasque.com/api/push-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSecret}` },
          body: JSON.stringify({
            user_id: oihan.ae_user_id,
            title: '💶 Virement débours confirmé',
            body: `${proprioNom} a confirmé le virement débours ${bienCode} ${facture.mois} — ${montant} €`,
            url: '/',
          }),
        }).catch(() => {})
      }
    }
  } catch { /* best-effort — la confirmation proprio n'échoue jamais pour un push raté */ }

  return confirmationRedirect('ok')
})
