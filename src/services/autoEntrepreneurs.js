import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

export async function getAutoEntrepreneurs() {
  const { data, error } = await supabase
    .from('auto_entrepreneur')
    .select('*')
    .eq('agence', AGENCE)
    .order('nom')
  if (error) throw error
  return data || []
}

export async function saveAutoEntrepreneur(ae) {
  const { id, ...fields } = ae
  if (id) {
    const { data, error } = await supabase
      .from('auto_entrepreneur')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  } else {
    const { data, error } = await supabase
      .from('auto_entrepreneur')
      .insert({ ...fields, agence: AGENCE })
      .select()
      .single()
    if (error) throw error
    return data
  }
}

export async function deleteAutoEntrepreneur(id) {
  const { error } = await supabase
    .from('auto_entrepreneur')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function createAEWithAuth(ae, email) {
  // 1. Créer la fiche AE en base (sans ae_user_id pour l'instant)
  const { data, error } = await supabase
    .from('auto_entrepreneur')
    .insert({ ...ae, email, agence: AGENCE })
    .select()
    .single()
  if (error) throw error

  // 2. Appeler via la route Vercel proxy — génère un lien d'invitation
  const fnResp = await fetch('/api/ae-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET },
    body: JSON.stringify({ action: 'create', ae_id: data.id, email })
  })
  if (!fnResp.ok) throw new Error('Erreur serveur: ' + fnResp.status)
  const fnData = await fnResp.json()
  if (fnData?.error) throw new Error(fnData.error)

  return { ae: data, email, link: fnData.link }
}

export async function createAEAccess(ae_id, email) {
  const fnResp = await fetch('/api/ae-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET },
    body: JSON.stringify({ action: 'create', ae_id, email })
  })
  const data = await fnResp.json()
  if (!fnResp.ok || data?.error) throw new Error(data?.error || `Erreur serveur ${fnResp.status}`)
  return { link: data.link, ae_user_id: data.user_id }
}

export async function resetAEPassword(ae_id) {
  const fnResp = await fetch('/api/ae-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET },
    body: JSON.stringify({ action: 'reset', ae_id })
  })
  if (!fnResp.ok) throw new Error('Erreur serveur: ' + fnResp.status)
  const data = await fnResp.json()
  if (data?.error) throw new Error(data.error)
  return { link: data.link, email: data.email }
}
