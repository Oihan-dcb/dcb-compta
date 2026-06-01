// Edge Function : owner-portal-revoke
// Supprime le compte auth.users d'un proprio secondaire (révocation accès portail).
//
// Corps : { auth_user_id: string }
//
// Sécurité : appelée uniquement avec le JWT d'un staff DCB authentifié dans dcb-compta.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return jsonError('Non authentifié', 401)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Vérifier que le caller est staff DCB
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !caller) return jsonError('Token invalide', 401)

    const allowedEmails = (Deno.env.get('ALLOWED_STAFF_EMAILS') ?? '').split(',').map(e => e.trim().toLowerCase())
    if (allowedEmails.length > 0 && !allowedEmails.includes(caller.email?.toLowerCase() ?? '')) {
      return jsonError('Accès refusé', 403)
    }

    const { auth_user_id } = await req.json()
    if (!auth_user_id) return jsonError('auth_user_id requis', 400)

    // Vérifier que l'utilisateur ciblé est bien un proprio secondaire (sécurité)
    const { data: proprio } = await supabaseAdmin
      .from('proprietaire')
      .select('id, parent_proprietaire_id')
      .eq('auth_user_id', auth_user_id)
      .maybeSingle()

    // On n'autorise la suppression que si c'est un secondaire (parent_proprietaire_id != null)
    // ou s'il n'existe plus en base (déjà supprimé du côté proprio)
    if (proprio && !proprio.parent_proprietaire_id) {
      return jsonError('Suppression non autorisée pour un proprio principal', 403)
    }

    // Supprimer le compte auth
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(auth_user_id)
    if (deleteErr) throw deleteErr

    return new Response(JSON.stringify({ success: true }), {
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
