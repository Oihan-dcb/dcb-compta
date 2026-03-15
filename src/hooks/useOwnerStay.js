import { supabase } from '../lib/supabase'

/**
 * Marque/démarque une resa comme séjour proprio.
 * Supprime aussi ses lignes de ventilation et remet le flag à false.
 * Retourne true si la mise à jour a réussi.
 */
export async function toggleOwnerStay(resa) {
  const newVal = !resa.owner_stay
  await supabase
    .from('reservation')
    .update({ owner_stay: newVal, ventilation_calculee: false })
    .eq('id', resa.id)
  // Supprimer les lignes ventilation dans les deux cas (marque ET démarque)
  await supabase.from('ventilation').delete().eq('reservation_id', resa.id)
  return newVal
}
