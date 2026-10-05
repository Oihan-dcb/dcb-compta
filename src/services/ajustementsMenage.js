// Ajustements ménage M+1 (I-155, 24/09/2026) — calcul UNIQUE partagé par la facture honoraires
// (facturesEvoliz.js) et le rapport propriétaire (buildRapportData.js), pour que les deux affichent
// toujours les mêmes lignes, quel que soit l'ordre de génération (rapports avant factures ou l'inverse).
//
// Le coût réel de l'aide-ménage est souvent connu APRÈS l'envoi de la facture du mois (ménage de
// fin de mois déclaré début M+1). update-ventilation-auto l'enregistre même sur un mois clôturé
// (migration 271) ; ventilation.fmen_facture mémorise ce qui a été facturé par résa. Toute
// dépassement sur un mois déjà envoyé sort en ligne « Ajustement ménage » (positif uniquement). Le marqueur n'est
// avancé qu'à l'ENVOI Evoliz (evoliz.js appliquerMarqueursAjustementMenage) : tant que la facture
// du mois n'est pas envoyée, ce calcul redonne les mêmes lignes.
import { supabase } from '../lib/supabase'

export async function calculerAjustementsMenage(proprioId, bienIds, mois) {
  if (!proprioId || !bienIds?.length) return []
  const [{ data: pastFact }, { data: pastFmen }] = await Promise.all([
    supabase.from('facture_evoliz').select('mois, statut')
      .eq('proprietaire_id', proprioId).eq('type_facture', 'honoraires').lt('mois', mois),
    supabase.from('ventilation')
      .select('id, mois_comptable, montant_ttc, montant_reel, fmen_facture, reservation:reservation_id(code, owner_stay, ventilation_manuelle)')
      .in('bien_id', bienIds).eq('code', 'FMEN')
      .gte('mois_comptable', '2026-05').lt('mois_comptable', mois)
      .not('fmen_facture', 'is', null),
  ])
  const moisEnvoyes = new Set((pastFact || []).filter(f => ['envoye_evoliz', 'payee'].includes(f.statut)).map(f => f.mois))
  const ajustements = []
  for (const v of (pastFmen || [])) {
    if (!moisEnvoyes.has(v.mois_comptable)) continue // mois pas encore envoyé → sa propre facture s'en charge
    if (v.reservation?.owner_stay || v.reservation?.ventilation_manuelle) continue
    const effectif = v.montant_reel != null ? v.montant_reel : (v.montant_ttc || 0)
    const delta = effectif - v.fmen_facture
    // Jamais d'ajustement négatif (règle Oïhan 05/10/2026 : « on rembourse pas » — forfait = forfait).
    // Si l'aide-ménage a coûté MOINS que ce qui a été facturé, le propriétaire ne récupère rien.
    // Le marqueur fmen_facture n'est pas avancé pour ces résas (pas de ligne sur la facture) : si le
    // coût réel remonte plus tard au-dessus du facturé, seul le dépassement sera facturé.
    if (delta <= 0) continue
    ajustements.push({ ventilation_id: v.id, ttc: delta, libelle: `Ajustement ménage ${v.reservation?.code || ''} (${v.mois_comptable}) — coût réel de l'aide-ménage` })
  }
  return ajustements
}
