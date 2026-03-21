import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ae_id, email, password } = await req.json()
    if (!ae_id || !email || !password) {
      return new Response(JSON.stringify({ error: 'ae_id, email et password requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Client admin avec service_role (disponible via env Supabase)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Créer le compte Auth
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    if (authErr) throw authErr

    // Lier l'ae_user_id à la fiche AE
    const { error: updateErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .update({ ae_user_id: authData.user.id })
      .eq('id', ae_id)
    if (updateErr) throw updateErr

    return new Response(JSON.stringify({ 
      success: true, 
      user_id: authData.user.id,
      email: authData.user.email
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})