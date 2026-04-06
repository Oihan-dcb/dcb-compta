/**
 * resyncOwnerStay — resynchronise la ventilation des réservations manuelles owner_stay
 *
 * Cible : reservation WHERE platform = 'manual' AND owner_stay = true
 * Action : DELETE ventilation + INSERT FMEN (si bien.forfait_menage_proprio > 0)
 * Safe : ne touche pas aux autres réservations ni aux prestation_hors_forfait
 *
 * Usage — depuis la console navigateur ou un bouton admin :
 *   import { resyncOwnerStay } from './scripts/resyncOwnerStay'
 *   await resyncOwnerStay({ dryRun: true })   // preview sans écriture
 *   await resyncOwnerStay({ dryRun: false })  // exécution réelle
 */
import { supabase } from '../lib/supabase'

export async function resyncOwnerStay({ dryRun = true } = {}) {
  console.log(`[resyncOwnerStay] mode: ${dryRun ? 'DRY RUN (aucune écriture)' : 'EXÉCUTION RÉELLE'}`)

  // 1. Charger toutes les resas concernées
  const { data: resas, error } = await supabase
    .from('reservation')
    .select('id, code, mois_comptable, bien_id, bien:bien_id(id, code, forfait_menage_proprio, proprietaire_id)')
    .eq('platform', 'manual')
    .eq('owner_stay', true)
    .order('mois_comptable')

  if (error) throw new Error('Fetch reservations: ' + error.message)
  if (!resas || resas.length === 0) {
    console.log('[resyncOwnerStay] Aucune réservation manual+owner_stay trouvée.')
    return { total: 0, traites: [] }
  }

  console.log(`[resyncOwnerStay] ${resas.length} réservation(s) ciblée(s) :`)
  resas.forEach(r => {
    const forfait = r.bien?.forfait_menage_proprio
    console.log(`  • ${r.code} | mois: ${r.mois_comptable} | bien: ${r.bien?.code} | forfait_menage_proprio: ${forfait ?? '—'}`)
  })

  if (dryRun) {
    console.log('[resyncOwnerStay] DRY RUN — aucune écriture effectuée. Relancer avec { dryRun: false } pour exécuter.')
    return { total: resas.length, traites: [], dryRun: true }
  }

  // 2. Pour chaque resa : DELETE ventilation + INSERT FMEN si forfait > 0
  const traites = []
  const erreurs = []

  for (const r of resas) {
    try {
      // DELETE ventilation existante
      const { error: delErr } = await supabase
        .from('ventilation')
        .delete()
        .eq('reservation_id', r.id)
      if (delErr) throw new Error('DELETE: ' + delErr.message)

      const forfait = r.bien?.forfait_menage_proprio
      if (forfait && forfait > 0) {
        const ttc = forfait
        const ht  = Math.round(ttc / 1.20)
        const tva = ttc - ht

        const { error: insErr } = await supabase.from('ventilation').insert({
          reservation_id:  r.id,
          bien_id:         r.bien?.id || r.bien_id,
          proprietaire_id: r.bien?.proprietaire_id || null,
          code:            'FMEN',
          libelle:         'Forfait ménage séjour proprio',
          montant_ht:      ht,
          montant_tva:     tva,
          montant_ttc:     ttc,
          taux_tva:        20,
          mois_comptable:  r.mois_comptable,
          calcul_source:   'owner_stay_auto',
        })
        if (insErr) throw new Error('INSERT FMEN: ' + insErr.message)

        console.log(`  ✅ ${r.code} (${r.mois_comptable}) — DELETE + INSERT FMEN ${ttc} TTC`)
        traites.push({ id: r.id, code: r.code, mois: r.mois_comptable, action: 'delete+insert_fmen', fmen_ttc: ttc })
      } else {
        console.log(`  ⚠️  ${r.code} (${r.mois_comptable}) — DELETE seulement (pas de forfait_menage_proprio)`)
        traites.push({ id: r.id, code: r.code, mois: r.mois_comptable, action: 'delete_only' })
      }
    } catch (e) {
      console.error(`  ❌ ${r.code} (${r.mois_comptable}) — ERREUR: ${e.message}`)
      erreurs.push({ id: r.id, code: r.code, mois: r.mois_comptable, erreur: e.message })
    }
  }

  console.log(`[resyncOwnerStay] Terminé — ${traites.length} OK, ${erreurs.length} erreur(s)`)
  return { total: resas.length, traites, erreurs }
}
