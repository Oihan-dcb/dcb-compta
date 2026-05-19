/**
 * owner-portal-calendar
 *
 * Retourne le calendrier enrichi d'un propriétaire pour le portail owner.
 * Auth : JWT Supabase du proprio (auth_user_id lié à proprietaire.auth_user_id).
 *
 * GET /owner-portal-calendar?from=2026-05-01&to=2026-12-31
 *
 * Réponse :
 * {
 *   proprio: { id, nom, prenom },
 *   biens: [
 *     {
 *       id, code, nom, photo_url,
 *       events: [
 *         {
 *           event_id, date_debut, date_fin,
 *           source,           // 'airbnb' | 'booking' | 'direct' | 'blocked'
 *           statut,           // 'confirmed' | 'cancelled' | 'blocked'
 *           prenom_client,    // null si bloqué
 *           canal,            // même que source, normalisé
 *           nb_nuits,
 *           nb_personnes,
 *           net_proprio,      // en centimes, null si pas encore ventilé
 *           ventile           // false = estimation pas encore calculée
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // ── 1. Auth : récupérer l'utilisateur depuis son JWT ──────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Non authentifié' }, 401)

    const sb = createClient(SUPABASE_URL, SERVICE_KEY)

    const { data: { user }, error: authErr } = await sb.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Token invalide' }, 401)

    // ── 2. Trouver le propriétaire lié à cet user ─────────────────────────────
    const { data: proprio, error: proErr } = await sb
      .from('proprietaire')
      .select('id, nom, prenom')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (proErr || !proprio) {
      return json({ error: 'Aucun propriétaire associé à ce compte' }, 403)
    }

    // ── 3. Paramètres de la fenêtre temporelle ────────────────────────────────
    const url    = new URL(req.url)
    const pFrom  = url.searchParams.get('from') || null   // ex: 2026-05-01
    const pTo    = url.searchParams.get('to')   || null   // ex: 2026-12-31

    // ── 4. Appel RPC owner_calendar ───────────────────────────────────────────
    const rpcParams: Record<string, unknown> = { p_proprio_id: proprio.id }
    if (pFrom) rpcParams.p_from = pFrom
    if (pTo)   rpcParams.p_to   = pTo

    const { data: rows, error: rpcErr } = await sb.rpc('owner_calendar', rpcParams)
    if (rpcErr) {
      console.error('owner_calendar RPC error:', rpcErr.message)
      return json({ error: 'Erreur serveur' }, 500)
    }

    // ── 5. Grouper par bien ───────────────────────────────────────────────────
    const biensMap = new Map<string, {
      id: string; code: string; nom: string; photo_url: string | null;
      events: unknown[]
    }>()

    for (const row of (rows ?? [])) {
      if (!biensMap.has(row.bien_id)) {
        biensMap.set(row.bien_id, {
          id: row.bien_id, code: row.bien_code, nom: row.bien_nom,
          photo_url: row.bien_photo, events: [],
        })
      }
      biensMap.get(row.bien_id)!.events.push({
        event_id:      row.event_id,
        date_debut:    row.date_debut,
        date_fin:      row.date_fin,
        source:        row.source,
        statut:        row.statut,
        prenom_client: row.prenom_client || null,
        canal:         normaliserCanal(row.canal),
        nb_nuits:      row.nb_nuits ?? null,
        nb_personnes:  row.nb_personnes ?? null,
        net_proprio:   row.net_proprio ?? null,   // centimes
        ventile:       row.ventile ?? false,
      })
    }

    return json({
      proprio: { id: proprio.id, nom: proprio.nom, prenom: proprio.prenom },
      biens: [...biensMap.values()],
    })

  } catch (err: any) {
    console.error('owner-portal-calendar error:', err.message)
    return json({ error: err.message }, 500)
  }
})

function normaliserCanal(raw: string | null): string {
  if (!raw) return 'direct'
  const r = raw.toLowerCase()
  if (r.includes('airbnb')) return 'Airbnb'
  if (r.includes('booking')) return 'Booking'
  if (r.includes('vrbo') || r.includes('abritel')) return 'Abritel'
  if (r === 'blocked') return 'Bloqué'
  if (r === 'direct') return 'Direct'
  return raw
}
