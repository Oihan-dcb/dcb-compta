// src/services/rapportBatch.js — brique de données pour le traitement groupé des rapports
// propriétaires (PageRapports.jsx : boutons "Télécharger tout" / "Envoi groupé", 30/08/2026).
//
// Ne duplique PAS le calcul métier : réutilise buildRapportData tel quel (même fonction que le
// rapport en vue simple). Ne duplique que le petit collage UI (notes bien_notes + choix du bien
// "ancre" MAITE) que PageRapports.jsx fait déjà dans charger() — nécessaire ici car le batch
// traite N proprios sans passer par l'état React de la page (pas de setSelectedPropId en boucle,
// qui serait lent et sujet aux races d'effets).
//
// Périmètre volontairement limité aux proprios "simples" (hors groupe_facturation='MAITE') :
// le choix chambre/global pour Maison Maïté est un arbitrage manuel qui reste sur la vue simple.
import { supabase } from '../lib/supabase'
import { buildRapportData as buildRapportDataService } from './buildRapportData'

// Réplique la partie non-MAITE de charger() (PageRapports.jsx) pour un item du batch.
export async function chargerRapportPourItem(proprio, bienId, mois) {
  const bien = (proprio.bien || []).find(b => b.id === bienId)
  const [notesRow, result] = await Promise.all([
    supabase.from('bien_notes')
      .select('note_marche, note_recommandations, note_analyse_llm, note_contexte, note_tendances, note_personnalisation')
      .eq('bien_id', bienId).eq('mois', mois).maybeSingle()
      .then(r => r.data || {}),
    buildRapportDataService(bienId, proprio.id, mois, { isGlobal: false, maiteIds: [] }),
  ])
  const nbAQualifier = (result.resas || []).reduce(
    (s, r) => s + (r.ajustements || []).filter(a => a.statut === 'a_qualifier').length, 0
  )
  return { bien, result, notesRow, nbAQualifier }
}

// Équivalent parametré de buildRendererPayload() (PageRapports.jsx) — même forme de payload
// consommée par genererRapportHTML/genererStatementHTML/genererMailStatementHTML, mais construit
// à partir de valeurs chargées explicitement plutôt que de l'état React de la page.
export function buildRendererPayloadFrom({ result, bien, notesRow }) {
  return {
    kpis: result.kpis, resas: result.resas, reviews: result.reviews,
    bien, kpisN1: result.kpisN1,
    llmAnalyse: notesRow.note_analyse_llm || '',
    llmContexte: notesRow.note_contexte || '',
    llmTendances: notesRow.note_tendances || '',
    noteMoisMoy: result.noteMoisMoy, noteGlobaleMoy: result.noteGlobaleMoy,
    nbReviewsGlobal: result.nbReviewsGlobal,
    notes: [{ bienName: bien?.hospitable_name, note: notesRow.note_marche || '' }],
    noteContexte: notesRow.note_marche || '',
    noteReco: notesRow.note_recommandations || '',
    tauxCommission: result.tauxCommission || 0,
    extrasGlobaux: result.extrasGlobaux || [],
    extrasParResa: result.extrasParResa || [],
    haownerList: result.haownerList || [],
    assuranceList: result.assuranceList || [],
    ownerStayMenageList: result.ownerStayList || [],
    fraisProprietaire: result.frais || [],
    colonnes: bien?.rapport_config?.colonnes || {},
  }
}

// Liste des proprios "simples" (hors MAITE) dont AUCUN bien n'a encore de rapport envoyé ce
// mois-ci — même filtre que la pastille "✓" du <select> de PageRapports.jsx, inversé.
export function listeProprioEnAttente(propsFiltres, biensEnvoyes, bienIdsActifs, agence) {
  return propsFiltres
    .filter(p => !(p.bien || []).some(b => b.groupe_facturation === 'MAITE'))
    .filter(p => !(p.bien || []).some(b => biensEnvoyes.has(b.id)))
    .map(p => {
      const bien = (p.bien || []).find(b => (b.listed || bienIdsActifs?.has(b.id)) && b.agence === agence)
      return bien ? { proprio: p, bienId: bien.id } : null
    })
    .filter(Boolean)
}
