import { supabase } from '../lib/supabase'

export async function getFraisParProprietaire(proprietaireId, mois) {
  const { data, error } = await supabase
    .from('frais_proprietaire')
    .select('*, bien (id, code, hospitable_name)')
    .eq('proprietaire_id', proprietaireId)
    .eq('mois_facturation', mois)
    .order('date')
  if (error) throw error
  return data || []
}

export async function getFraisParBien(bienId, mois) {
  const { data, error } = await supabase
    .from('frais_proprietaire')
    .select('*')
    .eq('bien_id', bienId)
    .eq('mois_facturation', mois)
    .order('date')
  if (error) throw error
  return data || []
}

export async function creerFrais(frais) {
  const { data, error } = await supabase
    .from('frais_proprietaire')
    .insert(frais)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function modifierFrais(id, updates) {
  const { data, error } = await supabase
    .from('frais_proprietaire')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function changerStatut(id, statut) {
  if (statut === 'facture') {
    const { data: existing, error: fetchErr } = await supabase
      .from('frais_proprietaire')
      .select('statut')
      .eq('id', id)
      .single()
    if (fetchErr) throw fetchErr
    if (existing.statut !== 'a_facturer') {
      throw new Error(`Impossible de passer en 'facture' depuis '${existing.statut}' — statut 'a_facturer' requis`)
    }
  }
  const { data, error } = await supabase
    .from('frais_proprietaire')
    .update({ statut })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
