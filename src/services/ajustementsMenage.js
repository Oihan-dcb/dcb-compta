// Ajustements ménage M+1 (I-155, 24/09/2026) — calcul UNIQUE partagé par la facture honoraires
// (facturesEvoliz.js), le rapport propriétaire (buildRapportData.js) et la régul FMEN interne.
//
// Règle Oïhan : le voyageur paie le MEN, réparti entre l'AE (AUTO réel) et DCB (FMEN = MEN − AUTO
// réel). Rien du MEN ne revient jamais au propriétaire. Le coût réel de l'AE est souvent connu APRÈS
// l'envoi de la facture du mois : ventilation.fmen_facture mémorise le FMEN déjà régularisé par résa,
// et l'écart (FMEN réel − fmen_facture) d'un mois déjà envoyé doit être régularisé :
//  • bien où le PROPRIÉTAIRE encaisse (mode_encaissement='proprio') : il paie lui-même la facture
//    FMEN → ligne « Ajustement ménage » (+/-) sur sa facture du mois (perimetre 'facture') ;
//  • bien où DCB encaisse (mode 'dcb') : l'argent vient des voyageurs via le séquestre, aucun
//    propriétaire concerné → plus de ligne sur sa facture (05/10/2026, Oïhan : « c'est que du
//    règlement interne ») ; les écarts sont regroupés dans UNE régul FMEN interne mensuelle
//    (perimetre 'interne', PageFactures → bloc « Régul FMEN interne »).
// Le marqueur fmen_facture n'avance qu'à l'envoi Evoliz de la facture (evoliz.js
// appliquerMarqueursAjustementMenage) ou à la validation de la régul interne
// (validerRegulFmenInterne) : tant que rien n'est validé, le calcul redonne les mêmes lignes.
import { supabase } from '../lib/supabase'
import { logOp } from './journal'

const DEBUT_AJUSTEMENTS = '2026-05'
const FIN_RATTRAPAGE_NON_REFACTURE = '2026-09'

// Écarts FMEN réel − déjà régularisé des mois dont la facture honoraires est envoyée.
// perimetre : 'facture' → seulement les biens où le propriétaire encaisse ; 'interne' → seulement
// les biens où DCB encaisse ; 'tous' → les deux.
async function ecartsFmen({ proprioId = null, bienIds, mois, perimetre }) {
  if (!bienIds?.length) return []
  const { data: biens } = await supabase.from('bien')
    .select('id, code, hospitable_name, mode_encaissement, proprietaire_id').in('id', bienIds)
  const bienById = new Map((biens || []).map(b => [b.id, b]))
  const garder = b => perimetre === 'tous' || (perimetre === 'facture' ? b?.mode_encaissement === 'proprio' : b?.mode_encaissement !== 'proprio')
  const idsGardes = bienIds.filter(id => garder(bienById.get(id)))
  if (!idsGardes.length) return []

  let qFact = supabase.from('facture_evoliz').select('proprietaire_id, mois, statut')
    .eq('type_facture', 'honoraires').lt('mois', mois).in('statut', ['envoye_evoliz', 'payee'])
  if (proprioId) qFact = qFact.eq('proprietaire_id', proprioId)
  const [{ data: pastFact }, { data: pastFmen }] = await Promise.all([
    qFact,
    supabase.from('ventilation')
      .select('id, bien_id, mois_comptable, montant_ttc, montant_reel, fmen_facture, reservation:reservation_id(code, owner_stay, ventilation_manuelle)')
      .in('bien_id', idsGardes).eq('code', 'FMEN')
      .gte('mois_comptable', DEBUT_AJUSTEMENTS).lt('mois_comptable', mois)
      .not('fmen_facture', 'is', null),
  ])
  const envoye = new Set((pastFact || []).map(f => `${f.proprietaire_id}|${f.mois}`))
  const ecarts = []
  for (const v of (pastFmen || [])) {
    const bien = bienById.get(v.bien_id)
    // Mois pas encore envoyé (pour le propriétaire du bien) → sa propre facture s'en charge
    if (!envoye.has(`${proprioId || bien?.proprietaire_id}|${v.mois_comptable}`)) continue
    if (v.reservation?.owner_stay || v.reservation?.ventilation_manuelle) continue
    const effectif = v.montant_reel != null ? v.montant_reel : (v.montant_ttc || 0)
    const delta = effectif - v.fmen_facture
    if (delta === 0) continue
    ecarts.push({
      ventilation_id: v.id, ttc: delta, bien_id: v.bien_id, bien_code: bien?.code || '', mois_comptable: v.mois_comptable,
      resa_code: v.reservation?.code || '',
      libelle: `Ajustement ménage ${v.reservation?.code || ''} (${v.mois_comptable}) — coût réel de l'aide-ménage`,
    })
  }
  return ecarts
}

// Lignes « Ajustement ménage » de la facture (et du rapport) d'un propriétaire : biens où il encaisse.
export async function calculerAjustementsMenage(proprioId, bienIds, mois) {
  if (!proprioId) return []
  const ecarts = await ecartsFmen({ proprioId, bienIds, mois, perimetre: 'facture' })
  // Rattrapage mai→août 2026 non refacturé (coût assumé par DCB, cf. calculerRegulFmenInterne)
  return ecarts.filter(e => e.mois_comptable >= FIN_RATTRAPAGE_NON_REFACTURE)
}

// Régul FMEN interne du mois : tous les biens DCB où DCB encaisse.
// Rattrapage mai→août 2026 (décision Oïhan 05/10/2026 : « pour les biens où les proprios sont facturés
// je vais assumer le coût ») : les écarts des biens où le PROPRIÉTAIRE encaisse antérieurs à septembre
// 2026 ne sont pas refacturés — ils sont listés à part (lignesNonRefacturees) et fermés à la validation,
// sans chiffre d'affaires. À partir des mois ≥ 2026-09, ils restent facturés au propriétaire.
const sortLignes = ls => ls.sort((a, b) => a.bien_code.localeCompare(b.bien_code) || a.mois_comptable.localeCompare(b.mois_comptable))
export async function calculerRegulFmenInterne(mois, agence = 'dcb') {
  const { data: biens } = await supabase.from('bien').select('id, mode_encaissement').eq('agence', agence)
  const ids = (biens || []).map(b => b.id)
  const [lignes, lignesProprio] = await Promise.all([
    ecartsFmen({ bienIds: ids, mois, perimetre: 'interne' }),
    ecartsFmen({ bienIds: ids, mois, perimetre: 'facture' }),
  ])
  const lignesNonRefacturees = lignesProprio.filter(l => l.mois_comptable < FIN_RATTRAPAGE_NON_REFACTURE)
  return {
    lignes: sortLignes(lignes), total: lignes.reduce((s, l) => s + l.ttc, 0),
    lignesNonRefacturees: sortLignes(lignesNonRefacturees), totalNonRefacture: lignesNonRefacturees.reduce((s, l) => s + l.ttc, 0),
  }
}

// Validation : les écarts sont considérés comme régularisés (marqueur avancé) et tracés dans
// journal_ops (détail complet pour la comptable). Recalcule au moment de valider pour ne
// jamais marquer un écart qui aurait changé entre l'affichage et le clic.
export async function validerRegulFmenInterne(mois, agence = 'dcb') {
  const { lignes, total, lignesNonRefacturees, totalNonRefacture } = await calculerRegulFmenInterne(mois, agence)
  for (const l of [...lignes, ...lignesNonRefacturees]) {
    const { data: v } = await supabase.from('ventilation').select('fmen_facture').eq('id', l.ventilation_id).maybeSingle()
    if (!v) continue
    const { error } = await supabase.from('ventilation').update({ fmen_facture: (v.fmen_facture || 0) + l.ttc }).eq('id', l.ventilation_id)
    if (error) throw error
  }
  await logOp({
    categorie: 'facture', action: 'regul_fmen_interne', statut: 'ok', source: 'app', mois_comptable: mois,
    message: `Régul FMEN interne ${mois} validée — ${lignes.length} écart(s), net ${(total / 100).toFixed(2)} € TTC (biens où DCB encaisse)`
      + (lignesNonRefacturees.length ? ` ; ${lignesNonRefacturees.length} écart(s) biens proprio non refacturés (${(totalNonRefacture / 100).toFixed(2)} €, coût assumé par DCB)` : ''),
    meta: { mois, agence, total_ttc: total, lignes, non_refacture_ttc: totalNonRefacture, lignes_non_refacturees: lignesNonRefacturees },
  })
  return { nb: lignes.length, total, nbNonRefacture: lignesNonRefacturees.length, totalNonRefacture }
}
