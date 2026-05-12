import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ae_id, email } = await req.json()
    if (!ae_id || !email) {
      return new Response(JSON.stringify({ error: 'ae_id et email requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Créer le compte avec un mot de passe aléatoire (jamais connu de personne)
    // email_confirm:true pour que le compte soit actif sans validation email préalable
    const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: crypto.randomUUID() + crypto.randomUUID(), // fort, jetable
      email_confirm: true,
    })
    if (createErr) throw createErr

    const userId = userData.user.id

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
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      email: userData.user.email,
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
