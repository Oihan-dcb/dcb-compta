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

export async function supprimerFrais(id) {
  const { error } = await supabase
    .from('frais_proprietaire')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Réinitialise un frais facturé → a_facturer pour permettre un re-traitement.
 * À utiliser quand la facture a été annulée ou recalculée.
 */
export async function annulerFacturationFrais(id) {
  const { data: existing, error: fetchErr } = await supabase
    .from('frais_proprietaire')
    .select('statut')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr
  if (existing.statut !== 'facture') {
    throw new Error(`Réinitialisation impossible : statut actuel '${existing.statut}' (attendu: 'facture')`)
  }
  const { data, error } = await supabase
    .from('frais_proprietaire')
    .update({
      statut: 'a_facturer',
      montant_deduit_loy: 0,
      montant_reliquat: 0,
      statut_deduction: 'en_attente',
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
