import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ae_id } = await req.json()
    if (!ae_id) {
      return new Response(JSON.stringify({ error: 'ae_id requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: ae, error: aeErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .select('ae_user_id, email')
      .eq('id', ae_id)
      .single()
    if (aeErr) throw aeErr
    if (!ae?.ae_user_id) throw new Error('Aucun compte Auth lié à cet AE (ae_user_id null)')
    if (!ae?.email) throw new Error('Email manquant sur la fiche AE')

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: ae.email,
    })
    if (linkErr) throw linkErr

    return new Response(JSON.stringify({
      success: true,
      link: linkData.properties.action_link,
      email: ae.email,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
