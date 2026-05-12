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

    // Créer le compte Auth via invite — génère un lien unique valable 24h
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
    })
    if (linkErr) throw linkErr

    const userId = linkData.user.id

    // Lier l'ae_user_id à la fiche AE (sans mdp_temporaire)
    const { error: updateErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .update({ ae_user_id: userId })
      .eq('id', ae_id)
    if (updateErr) throw updateErr

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      email: linkData.user.email,
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
