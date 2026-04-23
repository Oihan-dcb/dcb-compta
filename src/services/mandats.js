import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

export async function getProprietairesComplets() {
  const { data, error } = await supabase
    .from('proprietaire')
    .select(`
      *,
      bien(id, code, hospitable_name, listed, agence),
      mandat_gestion(*)
    `)
    .eq('agence', AGENCE)
    .order('nom')
  if (error) throw error
  return data || []
}

export async function updateProprietaire(id, payload) {
  const { error } = await supabase.from('proprietaire').update(payload).eq('id', id)
  if (error) throw error
}

export async function creerMandat(payload) {
  const { data, error } = await supabase
    .from('mandat_gestion')
    .insert({ ...payload, agence: AGENCE })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMandat(id, payload) {
  const { error } = await supabase.from('mandat_gestion').update(payload).eq('id', id)
  if (error) throw error
}

export async function supprimerMandat(id) {
  const { error } = await supabase.from('mandat_gestion').delete().eq('id', id)
  if (error) throw error
}
