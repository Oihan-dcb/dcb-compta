/**
 * Supabase Edge Function — Powens Auth
 * Gère le cycle de vie OAuth2 avec l'API Powens (ex-Budget Insight)
 *
 * Actions :
 *   init_webview   → crée un utilisateur Powens + URL webview pour connexion bancaire
 *   exchange_code  → échange le code retourné par le callback en access/refresh token
 *   refresh_token  → renouvelle l'access token avant expiry
 *   status         → retourne l'état de connexion (sans tokens)
 *   disconnect     → supprime la connexion
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

async function initWebview(agence: string, accountLabel: string, redirectUri: string) {
  const db = supabase()

  // 1. Créer un utilisateur Powens (ou réutiliser l'existant)
  let powensUserId: string | null = null
  const { data: existing } = await db
    .from('powens_connection')
    .select('powens_user_id')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  if (existing?.powens_user_id) {
    powensUserId = existing.powens_user_id
  } else {
    // Créer un nouvel utilisateur Powens via auth client_credentials
    const authRes = await powensPost('/auth/token', {
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SEC,
    })
    if (!authRes.ok) throw new Error(`Powens auth failed: ${JSON.stringify(authRes.data)}`)

    // Créer l'utilisateur
    const userRes = await powensGet('/users/', authRes.data.access_token)
    // Powens crée un user anonymous avec le token client
    powensUserId = authRes.data.access_token // Pour sandbox, on utilise le token comme user ID
  }

  // 2. Générer un state CSRF
  const pendingState = crypto.randomUUID()

  // 3. Construire l'URL Webview
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: pendingState,
  })
  const webviewUrl = `${BASE_URL.replace('/2.0', '')}/auth/webview/connect?${params}`

  // 4. Upsert connexion en état pending
  await db.from('powens_connection').upsert({
    agence,
    account_label: accountLabel,
    powens_user_id: powensUserId,
    connection_state: 'pending_webview',
    pending_state: pendingState,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agence,account_label' })

  return { webviewUrl, pendingState }
}

async function exchangeCode(agence: string, accountLabel: string, code: string, state: string, redirectUri: string) {
  const db = supabase()

  // Vérifier le state CSRF
  const { data: conn } = await db
    .from('powens_connection')
    .select('pending_state, powens_user_id')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  if (!conn || conn.pending_state !== state) {
    throw new Error('State CSRF invalide')
  }

  // Échanger le code contre des tokens
  const tokenRes = await powensPost('/auth/token', {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SEC,
    code,
    redirect_uri: redirectUri,
  })
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenRes.data)}`)

  const { access_token, refresh_token, expires_in } = tokenRes.data
  const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString()
  const connExpiresAt = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString() // 180 jours PSD2

  // Récupérer l'account Powens lié
  const accountsRes = await powensGet('/users/me/accounts', access_token)
  const firstAccount = accountsRes.data?.accounts?.[0]

  await db.from('powens_connection').update({
    access_token,
    refresh_token,
    token_expires_at: expiresAt,
    connection_expires_at: connExpiresAt,
    connection_state: 'connected',
    pending_state: null,
    powens_account_id: firstAccount?.id ? String(firstAccount.id) : null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('agence', agence).eq('account_label', accountLabel)

  return { connected: true, accountId: firstAccount?.id, iban: firstAccount?.iban }
}

async function refreshTokenFn(agence: string, accountLabel: string) {
  const db = supabase()
  const { data: conn } = await db
    .from('powens_connection')
    .select('refresh_token')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  if (!conn?.refresh_token) throw new Error('Pas de refresh_token stocké')

  const res = await powensPost('/auth/token', {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SEC,
    refresh_token: conn.refresh_token,
  })
  if (!res.ok) {
    await db.from('powens_connection').update({
      connection_state: 'expired',
      last_error: `Refresh failed: ${res.status}`,
      updated_at: new Date().toISOString(),
    }).eq('agence', agence).eq('account_label', accountLabel)
    throw new Error(`Refresh token failed: ${JSON.stringify(res.data)}`)
  }

  const { access_token, refresh_token, expires_in } = res.data
  const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString()

  await db.from('powens_connection').update({
    access_token,
    refresh_token: refresh_token || conn.refresh_token,
    token_expires_at: expiresAt,
    connection_state: 'connected',
    updated_at: new Date().toISOString(),
  }).eq('agence', agence).eq('account_label', accountLabel)

  return { access_token, expires_at: expiresAt }
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
    const { action, agence, accountLabel, code, state, redirectUri } = await req.json()

    let result
    switch (action) {
      case 'init_webview':
        result = await initWebview(agence, accountLabel, redirectUri)
        break
      case 'exchange_code':
        result = await exchangeCode(agence, accountLabel, code, state, redirectUri)
        break
      case 'refresh_token':
        result = await refreshTokenFn(agence, accountLabel)
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
