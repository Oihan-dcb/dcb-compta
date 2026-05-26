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
          subject: 'Votre espace propriétaire est prêt — Destination Côte Basque',
          html: `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(44,36,22,.10)">

  <!-- En-tête -->
  <tr>
    <td style="background:#CC9933;padding:32px 32px 28px;text-align:center">
      <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,.75);margin-bottom:10px">Conciergerie &amp; Gestion locative</div>
      <div style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:.5px">Destination Côte Basque</div>
      <div style="width:40px;height:2px;background:rgba(255,255,255,.4);margin:16px auto 0"></div>
    </td>
  </tr>

  <!-- Corps -->
  <tr>
    <td style="padding:36px 32px 28px">
      <p style="font-size:16px;font-weight:600;color:#2C2416;margin:0 0 8px">Bonjour ${nomProprio},</p>
      <p style="font-size:14px;line-height:1.75;color:#5A4E3C;margin:0 0 28px">
        Votre espace propriétaire est maintenant disponible. Retrouvez en un coup d'œil tout ce qui concerne votre bien : réservations, relevés, planning et messagerie directe avec notre équipe.
      </p>

      <!-- Ce que vous pouvez faire -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;border-radius:12px;padding:20px 20px 8px;margin-bottom:28px">
        <tr><td colspan="2" style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8C7B65;padding-bottom:14px">Votre espace en un coup d'œil</td></tr>
        <tr>
          <td width="32" valign="top" style="padding-bottom:12px;font-size:18px">📅</td>
          <td style="padding-bottom:12px;font-size:13px;color:#2C2416;line-height:1.5"><strong>Réservations &amp; planning</strong><br><span style="color:#6B5E4E">Consultez votre calendrier et les séjours à venir</span></td>
        </tr>
        <tr>
          <td width="32" valign="top" style="padding-bottom:12px;font-size:18px">📊</td>
          <td style="padding-bottom:12px;font-size:13px;color:#2C2416;line-height:1.5"><strong>Relevés mensuels</strong><br><span style="color:#6B5E4E">Suivez vos revenus et virements mois par mois</span></td>
        </tr>
        <tr>
          <td width="32" valign="top" style="padding-bottom:12px;font-size:18px">💬</td>
          <td style="padding-bottom:12px;font-size:13px;color:#2C2416;line-height:1.5"><strong>Messagerie directe</strong><br><span style="color:#6B5E4E">Échangez avec l'équipe, faites vos demandes de blocage</span></td>
        </tr>
        <tr>
          <td width="32" valign="top" style="padding-bottom:12px;font-size:18px">📄</td>
          <td style="padding-bottom:12px;font-size:13px;color:#2C2416;line-height:1.5"><strong>Documents</strong><br><span style="color:#6B5E4E">Mandats, factures et relevés accessibles à tout moment</span></td>
        </tr>
      </table>

      <!-- Bouton accès -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
        <tr><td align="center">
          <a href="${magicLink}" style="display:inline-block;background:#CC9933;color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:.3px">
            Accéder à mon espace →
          </a>
          <p style="font-size:11px;color:#9A8A7A;margin:10px 0 0">Lien valide 24h · connexion sécurisée</p>
        </td></tr>
      </table>

      <!-- Installer comme appli -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #E8DCC8;border-radius:12px;padding:20px;margin-bottom:16px">
        <tr>
          <td>
            <div style="font-size:13px;font-weight:700;color:#2C2416;margin-bottom:12px">📲 Installez l'application sur votre téléphone</div>
            <p style="font-size:12px;color:#6B5E4E;line-height:1.6;margin:0 0 10px">Pour un accès rapide depuis votre écran d'accueil :</p>
            <table width="100%" cellpadding="0" cellspacing="8">
              <tr>
                <td style="background:#F7F3EC;border-radius:8px;padding:10px 12px;font-size:12px;color:#2C2416;line-height:1.5" width="48%">
                  <strong>iPhone (Safari)</strong><br>
                  Appuyez sur <strong>⎋ Partager</strong> en bas → <em>"Sur l'écran d'accueil"</em>
                </td>
                <td width="4%"></td>
                <td style="background:#F7F3EC;border-radius:8px;padding:10px 12px;font-size:12px;color:#2C2416;line-height:1.5" width="48%">
                  <strong>Android (Chrome)</strong><br>
                  Menu <strong>⋮</strong> en haut à droite → <em>"Ajouter à l'écran d'accueil"</em>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Notifications -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #E8DCC8;border-radius:12px;padding:20px;margin-bottom:28px">
        <tr>
          <td>
            <div style="font-size:13px;font-weight:700;color:#2C2416;margin-bottom:8px">🔔 Activez les notifications</div>
            <p style="font-size:12px;color:#6B5E4E;line-height:1.6;margin:0">
              Lors de votre première connexion, <strong>acceptez les notifications</strong> pour être alerté dès qu'un message ou une mise à jour vous attend — sans avoir à ouvrir l'application.
            </p>
          </td>
        </tr>
      </table>

      <!-- Lien de secours -->
      <p style="font-size:11px;color:#9A8A7A;line-height:1.6;margin:0">
        Si le bouton ne fonctionne pas, copiez ce lien dans Safari ou Chrome :<br>
        <a href="${magicLink}" style="color:#CC9933;word-break:break-all;font-size:10px">${magicLink}</a>
      </p>
    </td>
  </tr>

  <!-- Pied de page -->
  <tr>
    <td style="background:#EAE3D4;border-top:1px solid #D9CEB8;padding:18px 32px;text-align:center">
      <p style="font-size:11px;color:#8C7B65;margin:0;line-height:1.6">
        <strong style="color:#5A4E3C">Destination Côte Basque</strong> · Conciergerie &amp; gestion locative à Biarritz<br>
        <a href="mailto:contact@destinationcotebasque.com" style="color:#CC9933;text-decoration:none">contact@destinationcotebasque.com</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`,
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
