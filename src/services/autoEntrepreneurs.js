import { supabase } from '../lib/supabase'

export async function getAutoEntrepreneurs() {
  const { data, error } = await supabase
    .from('auto_entrepreneur')
    .select('*')
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
      .insert(fields)
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
  // 1. Générer un mot de passe temporaire sécurisé
  const password = 'DCB' + Math.random().toString(36).slice(2, 8).toUpperCase() + Math.floor(Math.random()*100)

  // 2. Créer la fiche AE en base (sans ae_user_id pour l'instant)
  const { data, error } = await supabase
    .from('auto_entrepreneur')
    .insert({ ...ae, email })
    .select()
    .single()
  if (error) throw error

  // 3. Appeler l'Edge Function via fetch direct
  const fnResp = await fetch('https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/create-ae-user', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW5jY2h2eXBidHhrcGFsd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTE4NzIsImV4cCI6MjA4ODQ2Nzg3Mn0.jvPn6LkBfT1eeHmkGI-_vAD2pdM_Y0JWgtbJAG-DLjM', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ae_id: data.id, email, password })
  })
  if (!fnResp.ok) throw new Error('Edge Function inaccessible: ' + fnResp.status)
  const fnData = await fnResp.json()
  if (fnData?.error) throw new Error(fnData.error)

  return { ae: data, email, password }
}

export async function resetAEPassword(ae_id, email) {
  const password = 'DCB' + Math.random().toString(36).slice(2, 8).toUpperCase() + Math.floor(Math.random() * 100)
  const fnResp = await fetch('https://omuncchvypbtxkpalwcr.supabase.co/functions/v1/reset-ae-password', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW5jY2h2eXBidHhrcGFsd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTE4NzIsImV4cCI6MjA4ODQ2Nzg3Mn0.jvPn6LkBfT1eeHmkGI-_vAD2pdM_Y0JWgtbJAG-DLjM', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ae_id, email, password })
  })
  if (!fnResp.ok) throw new Error('Edge Function inaccessible: ' + fnResp.status)
  const data = await fnResp.json()
  if (data?.error) throw new Error(data.error)
  return { password }
}
