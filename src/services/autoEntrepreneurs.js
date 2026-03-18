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
