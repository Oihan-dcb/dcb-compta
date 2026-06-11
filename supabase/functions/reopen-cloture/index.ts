/**
 * Edge Function — Réouverture d'un bien clôturé (Oïhan uniquement)
 * POST { bien_id, mois, motif }  — Authorization: Bearer <supabase_access_token>
 *
 * 1. Vérifie le JWT et que l'appelant est Oïhan
 * 2. Désactive la clôture (cloture_bien.active = false) pour ce bien/mois
 * 3. Journalise dans cloture_bien_log (action 'reouverture')
 *
 * verify_jwt=true : appelé depuis dcb-compta avec la session de l'utilisateur.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OIHAN_EMAIL  = 'oihan@destinationcotebasque.com'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Token manquant' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return json({ error: 'Non authentifié' }, 401)
  if ((user.email || '').toLowerCase() !== OIHAN_EMAIL) {
    return json({ error: 'Réouverture réservée à Oïhan' }, 403)
  }

  const { bien_id, mois, motif } = await req.json().catch(() => ({}))
  if (!bien_id || !mois) return json({ error: 'bien_id et mois requis' }, 400)
  if (!motif || !String(motif).trim()) return json({ error: 'Un motif est obligatoire pour rouvrir' }, 400)

  const { data: updated, error: upErr } = await admin
    .from('cloture_bien')
    .update({ active: false })
    .eq('bien_id', bien_id).eq('mois', mois).eq('active', true)
    .select('id')
  if (upErr) return json({ error: upErr.message }, 500)
  if (!updated?.length) return json({ error: 'Aucune clôture active pour ce bien/mois' }, 404)

  await admin.from('cloture_bien_log').insert({
    bien_id, mois, action: 'reouverture', par: user.email, motif: String(motif).trim(),
  })

  return json({ ok: true, reopened: updated.length })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
