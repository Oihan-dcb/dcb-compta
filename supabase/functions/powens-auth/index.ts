/**
 * Supabase Edge Function — Powens Auth
 * Flux token (pas authorization_code — non supporté en sandbox Powens)
 *
 * Actions :
 *   init_webview     → crée un user Powens + URL webview avec token
 *   verify_callback  → vérifie le state CSRF après redirect, récupère le compte
 *   status           → retourne l'état de connexion (sans tokens)
 *   disconnect       → réinitialise la connexion
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE_URL   = Deno.env.get('POWENS_BASE_URL')!   // https://dcbcompta-sandbox.biapi.pro/2.0
const CLIENT_ID  = Deno.env.get('POWENS_CLIENT_ID')!
const CLIENT_SEC = Deno.env.get('POWENS_CLIENT_SECRET')!
const SUPA_URL   = Deno.env.get('SUPABASE_URL')!
const SUPA_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function supabase() {
  return createClient(SUPA_URL, SUPA_KEY)
}

// ── Helpers Powens ────────────────────────────────────────────────────────────

async function powensPost(path: string, body: object, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

async function powensGet(path: string, token: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Flux webview Powens AIS :
 * La webview crée elle-même le user et retourne le token directement dans le redirect
 * (?code=USER_TOKEN — ce code EST le token, pas un code OAuth à échanger)
 */
async function initWebview(agence: string, accountLabel: string, redirectUri: string) {
  const db = supabase()

  // Réutiliser le token existant si la connexion est encore valide
  const { data: existing } = await db
    .from('powens_connection')
    .select('access_token, connection_state')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  let userToken: string | null = null

  if (existing?.access_token && existing?.connection_state === 'connected') {
    userToken = existing.access_token
  } else {
    // Créer un utilisateur anonyme via Basic auth → token permanent
    const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SEC}`)
    const userRes = await fetch(`${BASE_URL}/users/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    const userData = await userRes.json()
    userToken = userData.auth_token || userData.access_token || null
  }

  // Générer un state CSRF
  const pendingState = crypto.randomUUID()

  // URL webview — avec token utilisateur si disponible, sinon flux code
  const params: Record<string, string> = {
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    state: pendingState,
  }
  if (userToken) params.token = userToken

  const webviewUrl = `${BASE_URL}/auth/webview/connect?${new URLSearchParams(params)}`

  await db.from('powens_connection').upsert({
    agence,
    account_label: accountLabel,
    access_token: userToken,
    connection_state: 'pending_webview',
    pending_state: pendingState,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agence,account_label' })

  return { webviewUrl }
}

/**
 * Appelé depuis le callback après redirect Powens.
 * Le ?code retourné par Powens EST le user access_token (pas un code OAuth à échanger).
 * On vérifie le state CSRF, on stocke le token, on récupère l'account_id.
 */
async function verifyCallback(agence: string, accountLabel: string, state: string, code?: string) {
  const db = supabase()

  const { data: conn } = await db
    .from('powens_connection')
    .select('pending_state, access_token')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  if (!conn || conn.pending_state !== state) {
    throw new Error('State CSRF invalide')
  }

  // Utiliser le token permanent déjà stocké (Basic auth flow),
  // ou le code retourné par le redirect si c'est le flux code
  const userToken = conn.access_token || code
  if (!userToken) throw new Error('Aucun token disponible')

  const connExpiresAt = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString()

  // Récupérer le compte bancaire lié
  const accountsRes = await powensGet('/users/me/accounts', userToken)
  const firstAccount = accountsRes.data?.accounts?.[0]

  await db.from('powens_connection').update({
    access_token: userToken,
    connection_state: 'connected',
    pending_state: null,
    powens_account_id: firstAccount?.id ? String(firstAccount.id) : null,
    connection_expires_at: connExpiresAt,
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('agence', agence).eq('account_label', accountLabel)

  return { connected: true, accountId: firstAccount?.id, iban: firstAccount?.iban }
}

async function getStatus(agence: string, accountLabel: string) {
  const db = supabase()
  const { data } = await db
    .from('powens_connection')
    .select('connection_state, connection_expires_at, last_sync_at, last_error, powens_account_id, agence, account_label')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()
  return data || { connection_state: 'disconnected' }
}

// ── Serve ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { action, agence, accountLabel, state, code, redirectUri } = await req.json()

    let result
    switch (action) {
      case 'init_webview':
        result = await initWebview(agence, accountLabel, redirectUri)
        break
      case 'verify_callback':
        result = await verifyCallback(agence, accountLabel, state, code)
        break
      case 'status':
        result = await getStatus(agence, accountLabel)
        break
      default:
        throw new Error(`Action inconnue: ${action}`)
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
