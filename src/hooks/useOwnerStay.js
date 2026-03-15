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
    .update({ owner_stay: newVal, ventilation_calculee: newVal })
    .eq('id', resa.id)

  // Supprimer les anciennes lignes dans tous les cas
  await supabase.from('ventilation').delete().eq('reservation_id', resa.id)

  if (newVal) {
    // Récupérer le forfait ménage du bien
    const { data: bien } = await supabase
      .from('bien')
      .select('forfait_menage_proprio, proprietaire_id')
      .eq('id', resa.bien?.id || resa.bien_id)
      .single()

    const forfait = bien?.forfait_menage_proprio
    if (forfait && forfait > 0) {
      // Calculer HT/TVA/TTC (TVA 20%)
      const ttc = forfait                              // stocké en centimes
      const ht  = Math.round(ttc / 1.20)
      const tva = ttc - ht

      await supabase.from('ventilation').insert({
        reservation_id: resa.id,
        bien_id: resa.bien?.id || resa.bien_id,
        proprietaire_id: bien.proprietaire_id || null,
        code: 'FMEN',
        libelle: 'Forfait ménage séjour proprio',
        montant_ht: ht,
        montant_tva: tva,
        montant_ttc: ttc,
        taux_tva: 20,
        mois_comptable: resa.mois_comptable,
        calcul_source: 'owner_stay_auto',
      })
    }
  }

  return newVal
}
