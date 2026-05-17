// Edge Function : owner-portal-invite
// Invoquée depuis dcb-compta (staff DCB) pour activer l'accès portail d'un propriétaire.
//
// Corps : { proprio_id: string, email: string }
//
// Actions :
//   1. Crée ou récupère le compte auth.users pour cet email
//   2. Lie proprietaire.auth_user_id → auth.users.id
//   3. Crée une config de visibilité par défaut (profil 'standard') si elle n'existe pas
//   4. Génère et renvoie un magic link OTP (valide 24h)
//
// Sécurité : appelée uniquement avec le JWT d'un staff DCB authentifié dans dcb-compta
// (vérification email dans ALLOWED_STAFF_EMAILS).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PORTAL_URL = Deno.env.get('OWNER_PORTAL_URL') ?? 'https://portail-owner.destinationcotebasque.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Auth : vérifier que le caller est un staff DCB authentifié ────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return jsonError('Non authentifié', 401)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Vérifier le JWT appelant
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !caller) return jsonError('Token invalide', 401)

    const allowedEmails = (Deno.env.get('ALLOWED_STAFF_EMAILS') ?? '').split(',').map(e => e.trim().toLowerCase())
    if (allowedEmails.length > 0 && !allowedEmails.includes(caller.email?.toLowerCase() ?? '')) {
      return jsonError('Accès refusé', 403)
    }

    // ── Paramètres ────────────────────────────────────────────────────────────
    const { proprio_id, email } = await req.json()
    if (!proprio_id || !email) return jsonError('proprio_id et email requis', 400)

    const emailLower = email.trim().toLowerCase()

    // ── Vérifier que le proprio existe ────────────────────────────────────────
    const { data: proprio, error: propErr } = await supabaseAdmin
      .from('proprietaire')
      .select('id, nom, prenom, agence, auth_user_id')
      .eq('id', proprio_id)
      .single()

    if (propErr || !proprio) return jsonError('Propriétaire non trouvé', 404)

    let userId: string

    if (proprio.auth_user_id) {
      // Déjà un compte lié → utiliser l'existant, juste renvoyer un nouveau lien
      userId = proprio.auth_user_id
    } else {
      // Chercher si un compte auth existe déjà pour cet email
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
      const existing = existingUsers?.users?.find(u => u.email?.toLowerCase() === emailLower)

      if (existing) {
        userId = existing.id
      } else {
        // Créer le compte — pas de mot de passe (magic link uniquement)
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: emailLower,
          email_confirm: true,
          user_metadata: {
            proprio_id,
            agence: proprio.agence,
            nom: proprio.nom,
            prenom: proprio.prenom,
          },
        })
        if (createErr) throw createErr
        userId = newUser.user.id
      }

      // Lier auth_user_id sur le proprio
      const { error: linkErr } = await supabaseAdmin
        .from('proprietaire')
        .update({ auth_user_id: userId })
        .eq('id', proprio_id)
      if (linkErr) throw linkErr
    }

    // ── Créer la config de visibilité par défaut si elle n'existe pas ─────────
    const { data: existingCfg } = await supabaseAdmin
      .from('owner_visibility_config')
      .select('id')
      .eq('proprietaire_id', proprio_id)
      .single()

    if (!existingCfg) {
      await supabaseAdmin.from('owner_visibility_config').insert({
        proprietaire_id: proprio_id,
        agence: proprio.agence ?? 'dcb',
        profil: 'standard',
        // Les valeurs par défaut de la table s'appliquent automatiquement
      })
    }

    // ── Générer le magic link OTP (valide 24h) ────────────────────────────────
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: emailLower,
      options: {
        redirectTo: PORTAL_URL,
      },
    })
    if (linkErr) throw linkErr

    const magicLink = linkData.properties.action_link
    const nomProprio = [proprio.prenom, proprio.nom].filter(Boolean).join(' ') || emailLower

    // ── Envoyer le lien par email via smtp-send ───────────────────────────────
    const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey      = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    let emailSent = false
    try {
      const emailRes = await fetch(`${supabaseUrl}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
        body: JSON.stringify({
          to: [emailLower],
          subject: 'Votre accès au portail propriétaire — Destination Côte Basque',
          html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#2C2416">
  <div style="background:#EAE3D4;border-bottom:3px solid #CC9933;padding:20px 24px">
    <div style="font-size:18px;font-weight:700;color:#CC9933">Destination Côte Basque</div>
    <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#6B5E4E;margin-top:2px">Conciergerie · Location · Gestion</div>
  </div>
  <div style="padding:28px 24px">
    <p style="font-size:15px;font-weight:600;margin:0 0 16px">Bonjour ${nomProprio},</p>
    <p style="font-size:14px;line-height:1.7;margin:0 0 20px">
      L'équipe Destination Côte Basque vous invite à accéder à votre espace propriétaire en ligne.
      Vous pourrez y consulter vos réservations, vos relevés mensuels et communiquer avec notre équipe.
    </p>
    <p style="font-size:14px;line-height:1.7;margin:0 0 20px">
      Cliquez sur le bouton ci-dessous pour accéder à votre espace (lien valide 24h) :
    </p>
    <a href="${magicLink}" style="display:inline-block;background:#CC9933;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
      Accéder à mon espace →
    </a>
    <p style="font-size:12px;color:#8C7B65;margin:24px 0 0;line-height:1.6">
      Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
      <a href="${magicLink}" style="color:#CC9933;word-break:break-all">${magicLink}</a>
    </p>
    <p style="font-size:12px;color:#8C7B65;margin:16px 0 0;line-height:1.6">
      Destination Côte Basque — Conciergerie et gestion locative à Biarritz
    </p>
  </div>
</div>`,
        }),
      })
      emailSent = emailRes.ok
    } catch (_e) {
      // Email non bloquant — le magic_link est retourné dans la réponse
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      email: emailLower,
      magic_link: magicLink,
      email_sent: emailSent,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
