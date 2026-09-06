// src/services/rapportBatch.js — brique de données pour le traitement groupé des rapports
// propriétaires (PageRapports.jsx : boutons "Télécharger tout" / "Envoi groupé", 30/08/2026).
//
// Ne duplique PAS le calcul métier : réutilise buildRapportData tel quel (même fonction que le
// rapport en vue simple). Ne duplique que le petit collage UI (notes bien_notes + payload
// renderer) que PageRapports.jsx fait déjà dans charger()/buildRendererPayload() — nécessaire ici
// car le batch traite N proprios sans passer par l'état React de la page (pas de
// setSelectedPropId en boucle, qui serait lent et sujet aux races d'effets).
//
// Maison Maïté (groupe_facturation='MAITE') : envoie CHAQUE chambre ET le global (consolidé) —
// confirmé par Oïhan 30/08/2026, ce n'est pas un choix exclusif chambre/global comme la vue
// simple le suggère. Le global est ancré sur le bien "Maison MAÏTÉ" (code M-MAITE, l'entité
// maison entière) : il n'existe pas de bien code='MAISON' dans ce jeu de données (contrairement à
// ce que suppose PageRapports.jsx pour son propre ancrage en vue simple — un écart pré-existant,
// hors périmètre ici) ; M-MAITE est l'ancre la plus stable disponible.
import { supabase } from '../lib/supabase'
import { buildRapportData as buildRapportDataService } from './buildRapportData'

// Réplique la partie collage UI de charger() (PageRapports.jsx) pour un item du batch.
// opts: { isGlobal, maiteIds } — mêmes clés que buildRapportData, cf. Maison Maïté ci-dessus.
export async function chargerRapportPourItem(proprio, bienId, mois, opts = {}) {
  const { isGlobal = false, maiteIds = [] } = opts
  const bienBrut = (proprio.bien || []).find(b => b.id === bienId)
  // Même substitution de nom que buildRendererPayload() en vue simple (isMaite && modeMaite==='global').
  const bien = isGlobal ? { ...bienBrut, hospitable_name: 'Maison Maïté' } : bienBrut
  const [notesRow, result] = await Promise.all([
    supabase.from('bien_notes')
      .select('note_marche, note_recommandations, note_analyse_llm, note_contexte, note_tendances, note_personnalisation')
      .eq('bien_id', bienId).eq('mois', mois).maybeSingle()
      .then(r => r.data || {}),
    buildRapportDataService(bienId, proprio.id, mois, { isGlobal, maiteIds }),
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

// Liste des rapports en attente ce mois-ci : un item par bien "simple" non déjà envoyé, et pour
// Maison Maïté un item par chambre PLUS un item global consolidé — tous non déjà envoyés
// (biensEnvoyes, vérifié par bien_id : chaque chambre a le sien, le global est ancré sur M-MAITE).
export function listeProprioEnAttente(propsFiltres, biensEnvoyes, bienIdsActifs, agence) {
  const items = []
  for (const p of propsFiltres) {
    const biens = p.bien || []
    const maiteBiens = biens.filter(b => b.groupe_facturation === 'MAITE')
    if (maiteBiens.length > 0) {
      // M-MAITE (la maison entière — buyout/direct) NE doit PAS être traitée comme une chambre de
      // plus dans cette boucle : c'est l'ancre du rapport global juste en dessous, pas une 6e
      // chambre. Bug réel trouvé le 06/09/2026 (Oïhan, comparaison des PDF générés) : avant ce
      // correctif, M-MAITE produisait AUSSI un rapport "chambre" (isGlobal:false) ne contenant que
      // ses propres réservations directes/buyout — doublon incomplet du global, qui serait parti
      // par erreur à l'envoi groupé sous le nom brut "Maison MAÏTÉ" (pas la présentation voulue).
      const maison = maiteBiens.find(b => b.code === 'M-MAITE') || maiteBiens[0]
      for (const chambre of maiteBiens) {
        if (chambre.id === maison.id) continue
        const active = (chambre.listed || bienIdsActifs?.has(chambre.id)) && chambre.agence === agence
        if (active && !biensEnvoyes.has(chambre.id)) {
          items.push({ proprio: p, bienId: chambre.id, isGlobal: false, maiteIds: [], label: chambre.hospitable_name || chambre.code })
        }
      }
      if (!biensEnvoyes.has(maison.id)) {
        items.push({ proprio: p, bienId: maison.id, isGlobal: true, maiteIds: maiteBiens.map(b => b.id), label: 'Maison Maïté (global)' })
      }
      continue
    }
    const bien = biens.find(b => (b.listed || bienIdsActifs?.has(b.id)) && b.agence === agence)
    if (bien && !biensEnvoyes.has(bien.id)) {
      items.push({ proprio: p, bienId: bien.id, isGlobal: false, maiteIds: [], label: bien.hospitable_name || bien.code })
    }
  }
  return items
}
