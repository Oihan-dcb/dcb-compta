// scripts/backfill-owner-documents-2026.mjs
//
// Backfill ponctuel (2026-09-10) : les rapports mensuels 2026 déjà envoyés par
// email (bien_notes.rapport_envoye_at) mais jamais poussés vers le portail
// propriétaire (owner_documents, categorie='releve') — trou comblé pour l'avenir
// par le transfert automatique (cf. commit "Transfert automatique des rapports
// vers le portail propriétaire"), mais les mois déjà envoyés avant ce commit
// restent absents du portail sans ce script.
//
// Réutilise exactement la même logique que api/rapport-to-portail.js (génération
// PDF, upload storage, upsert owner_documents) MAIS :
//   - tourne en local (puppeteer complet, pas puppeteer-core/@sparticuz/chromium
//     qui vise l'environnement Lambda) ;
//   - saute délibérément l'étape 4 (notification portail) : on ne veut pas
//     renvoyer 100+ notifications "nouveau relevé" pour des mois anciens.
//   - exclut les biens Maison Maïté (groupe_facturation='MAITE') : le mode
//     "global" (rapport consolidé envoyé sur le bien MAISON, cf. PageRapports.jsx
//     isGlobal) ne peut pas être reconstruit fidèlement bien par bien — à traiter
//     à la main si besoin (7 lignes concernées, cf. sortie du script).
//
// Usage : node --env-file=.env.local scripts/backfill-owner-documents-2026.mjs [--dry-run]
import puppeteer from 'puppeteer'
import { supabase } from '../src/lib/supabase.js'
import { buildRapportData } from '../src/services/buildRapportData.js'
import { genererStatementHTML } from '../src/services/rapportStatement.js'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (aucune écriture) ===' : '=== EXÉCUTION RÉELLE ===')

  const { data: sentRows, error: sentErr } = await supabase
    .from('bien_notes')
    .select('bien_id, mois')
    .like('mois', '2026-%')
    .not('rapport_envoye_at', 'is', null)
  if (sentErr) throw sentErr

  const { data: existingDocs, error: docsErr } = await supabase
    .from('owner_documents')
    .select('bien_id, mois_comptable')
    .eq('categorie', 'releve')
    .like('mois_comptable', '2026-%')
  if (docsErr) throw docsErr

  const existingSet = new Set(existingDocs.map(d => `${d.bien_id}|${d.mois_comptable}`))
  const allMissing = sentRows.filter(r => !existingSet.has(`${r.bien_id}|${r.mois}`))

  const bienIds = [...new Set(allMissing.map(t => t.bien_id))]
  const { data: biens, error: biensErr } = await supabase
    .from('bien')
    .select('id, proprietaire_id, code, hospitable_name, groupe_facturation, agence, rapport_config')
    .in('id', bienIds)
  if (biensErr) throw biensErr
  const bienById = new Map(biens.map(b => [b.id, b]))

  const maiteSkipped = allMissing.filter(t => bienById.get(t.bien_id)?.groupe_facturation === 'MAITE')
  const targets = allMissing.filter(t => bienById.get(t.bien_id)?.groupe_facturation !== 'MAITE')

  console.log(`${allMissing.length} rapports 2026 envoyés par email mais absents du portail.`)
  console.log(`  → ${maiteSkipped.length} exclus (Maison Maïté, mode "global" non reconstruit fidèlement) :`)
  for (const t of maiteSkipped) console.log(`      ${bienById.get(t.bien_id)?.code} ${t.mois}`)
  console.log(`  → ${targets.length} à générer.`)

  const propIds = [...new Set(biens.map(b => b.proprietaire_id).filter(Boolean))]
  const { data: proprios, error: propErr } = await supabase
    .from('proprietaire')
    .select('id, nom, prenom, email, bien!proprietaire_id(id, groupe_facturation)')
    .in('id', propIds)
  if (propErr) throw propErr
  const proprioById = new Map(proprios.map(p => [p.id, p]))

  if (DRY_RUN) {
    for (const t of targets) {
      const b = bienById.get(t.bien_id)
      console.log(`  [dry-run] ${b?.code || t.bien_id} — ${t.mois} — proprio ${proprioById.get(b?.proprietaire_id)?.nom || '?'}`)
    }
    console.log('Dry run terminé, aucune écriture effectuée.')
    return
  }

  const browser = await puppeteer.launch({ headless: true })
  let ok = 0, fail = 0
  const echecs = []

  for (const t of targets) {
    const bien = bienById.get(t.bien_id)
    const proprio = proprioById.get(bien?.proprietaire_id)
    if (!bien || !proprio) {
      fail++; echecs.push({ ...t, raison: 'bien/proprio introuvable' })
      console.error(`ÉCHEC ${t.bien_id} ${t.mois} : bien/proprio introuvable`)
      continue
    }
    try {
      const { data: notesRow } = await supabase
        .from('bien_notes')
        .select('note_marche, note_recommandations, note_analyse_llm, note_contexte, note_tendances')
        .eq('bien_id', t.bien_id).eq('mois', t.mois).maybeSingle()

      const result = await buildRapportData(t.bien_id, proprio.id, t.mois, { isGlobal: false, maiteIds: [] })

      const rapportData = {
        kpis: result.kpis, resas: result.resas, reviews: result.reviews,
        bien, kpisN1: result.kpisN1,
        llmAnalyse: notesRow?.note_analyse_llm || '',
        llmContexte: notesRow?.note_contexte || '',
        llmTendances: notesRow?.note_tendances || '',
        noteMoisMoy: result.noteMoisMoy, noteGlobaleMoy: result.noteGlobaleMoy,
        nbReviewsGlobal: result.nbReviewsGlobal,
        notes: [{ bienName: bien.hospitable_name, note: notesRow?.note_marche || '' }],
        noteContexte: notesRow?.note_marche || '',
        noteReco: notesRow?.note_recommandations || '',
        tauxCommission: result.tauxCommission || 0,
        extrasGlobaux: result.extrasGlobaux || [],
        extrasParResa: result.extrasParResa || [],
        haownerList: result.haownerList || [],
        assuranceList: result.assuranceList || [],
        ownerStayMenageList: result.ownerStayList || [],
        fraisProprietaire: result.frais || [],
        colonnes: bien.rapport_config?.colonnes || {},
      }

      const html = genererStatementHTML(proprio, t.mois, rapportData)

      const page = await browser.newPage()
      await page.setBypassCSP(true)
      await page.emulateMediaType('print')
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 })
      await page.evaluate(() => Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete || img.naturalWidth === 0)
          .map(img => new Promise(resolve => {
            img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 3000)
          }))
      ))
      const pdf = await page.pdf({
        format: 'A4', landscape: true, printBackground: true,
        margin: { top: '8mm', right: '6mm', bottom: '8mm', left: '6mm' },
      })
      await page.close()

      const storagePath = `rapports/${proprio.id}/${bien.id}/${t.mois}.pdf`
      const { error: upErr } = await supabase.storage
        .from('owner-documents')
        .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw upErr

      const [year, month] = t.mois.split('-').map(Number)
      const moisLabel = new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      const nomDoc = `Rapport ${moisLabel} — ${bien.hospitable_name || bien.code}`

      await supabase.from('owner_documents').delete()
        .match({ proprietaire_id: proprio.id, bien_id: bien.id, mois_comptable: t.mois, categorie: 'releve' })
      const { error: insErr } = await supabase.from('owner_documents').insert({
        proprietaire_id: proprio.id, bien_id: bien.id, nom: nomDoc, categorie: 'releve',
        storage_path: storagePath, date_document: `${t.mois}-01`, mois_comptable: t.mois,
      })
      if (insErr) throw insErr

      ok++
      console.log(`OK ${ok}/${targets.length} — ${bien.code} ${t.mois}`)
    } catch (e) {
      fail++; echecs.push({ ...t, raison: e.message })
      console.error(`ÉCHEC ${bien?.code || t.bien_id} ${t.mois} :`, e.message)
    }
  }

  await browser.close()
  console.log(`\nTerminé : ${ok} générés, ${fail} échecs sur ${targets.length} (+ ${maiteSkipped.length} MAITE exclus).`)
  if (echecs.length) {
    console.log('Détail des échecs :')
    for (const e of echecs) console.log(`  ${e.bien_id} ${e.mois} : ${e.raison}`)
  }
}

main().catch(e => { console.error('ERREUR FATALE:', e); process.exit(1) })
