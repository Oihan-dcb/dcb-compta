/**
 * POST vers une API route Vercel avec JWT Supabase en Authorization.
 * Remplace les appels avec x-internal-secret.
 */
import { supabase } from './supabase'

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expirée — veuillez vous reconnecter')
  return `Bearer ${session.access_token}`
}

/** POST JSON → retourne { ok, status, data } */
export async function authPost(url, body) {
  const auth = await getAuthHeader()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

/** POST JSON → retourne la Response brute (pour les binaires : PDF, etc.) */
export async function authPostRaw(url, body) {
  const auth = await getAuthHeader()
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(body),
  })
}
