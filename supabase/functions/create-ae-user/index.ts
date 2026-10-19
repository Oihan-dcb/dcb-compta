import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ae_id, email, redirect_to } = await req.json()
    if (!ae_id || !email) {
      return new Response(JSON.stringify({ error: 'ae_id et email requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Réservé au bureau (ou à un appel serveur en clé de service) : cette fonction peut
    // désormais relier un compte EXISTANT à une fiche, un AE ne doit pas pouvoir l'appeler.
    const jeton = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    // Clé serveur (ancien ou nouveau format) = seule à pouvoir lister les comptes auth.
    let estService = jeton !== '' && jeton === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    if (!estService && jeton) {
      const test = createClient(Deno.env.get('SUPABASE_URL') ?? '', jeton)
      const { error: tErr } = await test.auth.admin.listUsers({ page: 1, perPage: 1 })
      estService = !tErr
    }
    if (!estService) {
      const appelant = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: `Bearer ${jeton}` } },
      })
      const { data: bureau } = await appelant.rpc('auth_user_is_bureau')
      if (bureau !== true) {
        return new Response(JSON.stringify({ error: 'Réservé au bureau' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Créer le compte avec un mot de passe aléatoire (jamais connu de personne)
    // email_confirm:true pour que le compte soit actif sans validation email préalable
    // Compte déjà existant pour cet e-mail (essai précédent interrompu, 19/10/2026 : le lien
    // ae_user_id avait été refusé après la création du compte) → on le réutilise au lieu
    // d'échouer, sauf s'il est déjà relié à une AUTRE fiche AE.
    const emailNorm = String(email).trim().toLowerCase()
    let userId: string | null = null
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data: lst, error: lstErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
      if (lstErr) throw lstErr
      const u = (lst?.users ?? []).find((x) => (x.email ?? '').toLowerCase() === emailNorm)
      if (u) userId = u.id
      if ((lst?.users ?? []).length < 1000) break
    }
    if (userId) {
      const { data: autre } = await supabaseAdmin.from('auto_entrepreneur')
        .select('id, prenom, nom').eq('ae_user_id', userId).neq('id', ae_id).limit(1)
      if (autre?.length) {
        return new Response(JSON.stringify({ error: `Ce compte est déjà relié à la fiche de ${autre[0].prenom} ${autre[0].nom ?? ''}`.trim() }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    } else {
      const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailNorm,
        password: crypto.randomUUID() + crypto.randomUUID(), // fort, jetable
        email_confirm: true,
      })
      if (createErr) throw createErr
      userId = userData.user.id
    }

    // Lier l'ae_user_id à la fiche AE
    const { error: updateErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .update({ ae_user_id: userId })
      .eq('id', ae_id)
    if (updateErr) throw updateErr

    // Générer un lien recovery → force la création du vrai mot de passe au premier accès
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      // Sans redirectTo explicite, Supabase retombe sur le Site URL global du projet
      // (partagé avec dcb-compta) — envoyait les AE sur dcb-compta au lieu du portail.
      // redirect_to optionnel (ex. invitation PowerHouse, dcb-planning/api/powerhouse-invite.js)
      // permet de rediriger ailleurs que le Portail AE sans dupliquer cette fonction.
      options: { redirectTo: redirect_to || 'https://staff-app.destinationcotebasque.com' },
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      email: emailNorm,
      link: linkData.properties.action_link,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
