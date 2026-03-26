import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Génère un mot de passe aléatoire lisible (8 caractères alphanumériques)
function genererMotDePasse() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let mdp = ''
  for (let i = 0; i < 8; i++) {
    mdp += chars[Math.floor(Math.random() * chars.length)]
  }
  return mdp
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

    // Récupérer l'ae_user_id depuis la fiche AE
    const { data: ae, error: aeErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .select('ae_user_id, email')
      .eq('id', ae_id)
      .single()
    if (aeErr) throw aeErr
    if (!ae?.ae_user_id) throw new Error('Aucun compte Auth lié à cet AE (ae_user_id null)')

    // Générer le nouveau mot de passe
    const newPassword = genererMotDePasse()

    // Mettre à jour le mot de passe dans Supabase Auth
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
      ae.ae_user_id,
      { password: newPassword }
    )
    if (authErr) throw authErr

    // Synchroniser mdp_temporaire en base (CF-PAE1 / CF-PAE2)
    const { error: updateErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .update({ mdp_temporaire: newPassword })
      .eq('id', ae_id)
    if (updateErr) throw updateErr

    return new Response(JSON.stringify({
      success: true,
      password: newPassword,
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
