import { supabase } from '../lib/supabase'

/**
 * Marque/démarque une resa comme séjour proprio.
 * Si owner_stay → true ET bien a un forfait_menage_proprio :
 *   → génère automatiquement une ligne FMEN (TTC = forfait HT + TVA 20%)
 * Si owner_stay → false :
 *   → supprime les lignes ventilation
 */
export async function toggleOwnerStay(resa) {
  const newVal = !resa.owner_stay

  // Mettre à jour le flag
  await supabase
    .from('reservation')
    .update({ owner_stay: newVal, ventilation_calculee: newVal, rapprochee: newVal })
    .eq('id', resa.id)

  // Supprimer les anciennes lignes dans tous les cas
  // Le montant ménage doit être saisi manuellement depuis la valeur Hospitable
  await supabase.from('ventilation').delete().eq('reservation_id', resa.id)

  return newVal
}
