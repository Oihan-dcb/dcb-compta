// Edge Function : toggle-ae-access
// Coupe ou restaure l'accès de connexion (auth.users) d'un staff/AE lors d'un archivage/
// réactivation. Bannit (ban_duration) plutôt que de supprimer le compte auth : réversible,
// garde le même ae_user_id donc pas de ré-invitation à refaire à la réactivation.
//
// Corps : { ae_id: string, actif: boolean }
//
// Sécurité : appelée uniquement via api/ae-action.js (JWT + ALLOWED_ADMIN_EMAILS déjà
// vérifiés là-bas), depuis dcb-compta OU dcb-planning (proxy api/staff-action.js).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { ae_id, actif } = await req.json()
    if (!ae_id || typeof actif !== 'boolean') {
      return jsonError('ae_id et actif (boolean) requis', 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: ae, error: fetchErr } = await supabaseAdmin
      .from('auto_entrepreneur')
      .select('id, ae_user_id')
      .eq('id', ae_id)
      .maybeSingle()
    if (fetchErr) throw fetchErr

    // Pas de compte auth lié (jamais invité) : rien à couper/restaurer, pas une erreur.
    if (!ae?.ae_user_id) {
      return new Response(JSON.stringify({ success: true, skipped: 'pas_de_compte_auth' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(ae.ae_user_id, {
      ban_duration: actif ? 'none' : '876000h', // ~100 ans = permanent tant que non réactivé
    })
    if (banErr) throw banErr

    return new Response(JSON.stringify({ success: true, ae_user_id: ae.ae_user_id, banned: !actif }), {
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
