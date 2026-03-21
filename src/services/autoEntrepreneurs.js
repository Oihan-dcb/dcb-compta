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

  // 3. Appeler l'Edge Function pour créer le compte Auth
  const { data: fnData, error: fnErr } = await supabase.functions.invoke('create-ae-user', {
    body: { ae_id: data.id, email, password }
  })
  if (fnErr) throw fnErr
  if (fnData?.error) throw new Error(fnData.error)

  return { ae: data, email, password }
}
