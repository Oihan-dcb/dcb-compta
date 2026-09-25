// scripts/import-detail-remise.mjs — importe les PDF « Détail Remise de virement SEPA » de la
// Caisse d'Épargne dans sct_export (composition d'une remise groupée « REM VIR SEPA »).
//
// Pourquoi : la banque ne débite qu'une ligne par remise ; sans sa composition, impossible de
// savoir quels propriétaires ont été payés (25/09/2026 : loyers LAGREOU/ASKIDA de juillet-août
// crus impayés alors qu'ils étaient dans les remises du 06/08 et du 07/09). PageExports mémorise
// déjà les fichiers générés PAR L'APP ; ce script couvre les remises saisies ailleurs.
//
// Usage : node --env-file=.env.local scripts/import-detail-remise.mjs [--dry] fichier1.pdf [fichier2.pdf …]
// Chaque ligne est rattachée à la facture d'honoraires du mois précédant l'exécution : par le nom
// imprimé par la banque s'il y en a un, sinon par le montant exact (montant_reversement). Les
// doublons (même remise téléchargée plusieurs fois) sont ignorés. Requiert pdftotext (poppler).

import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const fichiers = args.filter(a => !a.startsWith('--'))
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const AGENCE = process.env.VITE_AGENCE || 'dcb'

const cts = s => Math.round(parseFloat(s.replace(/\s/g, '').replace(',', '.')) * 100)
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
const moisPrecedent = iso => { const [y, m] = iso.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }

function parser(fichier) {
  const txt = execFileSync('pdftotext', ['-layout', fichier, '-'], { encoding: 'utf8' })
  const exec = txt.match(/Date d.ex[ée]cution souhait[ée]e\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/)
  const total = txt.match(/Mt Total:\s*([\d\s]+,\d{2})\s*EUR/)
  if (!exec || !total) throw new Error(`${fichier} : en-tête de remise introuvable`)
  const lignes = []
  const rows = txt.split('\n')
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(/^\s+(\d{1,3})\s+([A-Z0-9]{8,11})\s+(.*?)\s{2,}([\d\s]+,\d{2})\s*EUR\s*$/)
    if (!m) continue
    // Lignes suivantes, indentées, sans montant : IBAN et/ou nom du bénéficiaire (selon la remise)
    let nom = null, iban = null
    for (const suiv of rows.slice(i + 1, i + 3)) {
      if (!/^\s{10,}\S/.test(suiv) || /EUR|Rang|Total|Société/.test(suiv)) break
      const t = suiv.trim()
      if (/^[A-Z]{2}\d{2}[\dA-Z ]{10,}$/.test(t)) iban = t.replace(/\s/g, '')
      else nom = t
    }
    lignes.push({ rang: Number(m[1]), bic: m[2], motif: m[3].trim(), montant_cts: cts(m[4]), nom, iban })
  }
  const dateExec = `${exec[3]}-${exec[2]}-${exec[1]}`
  const totalCts = cts(total[1])
  const somme = lignes.reduce((s, l) => s + l.montant_cts, 0)
  if (somme !== totalCts) throw new Error(`${fichier} : lignes ${somme / 100} ≠ total ${totalCts / 100}`)
  return { fichier, dateExec, totalCts, lignes }
}

const remises = new Map()
for (const f of fichiers) {
  const r = parser(f)
  const cle = `${r.dateExec}_${r.totalCts}`
  if (!remises.has(cle)) remises.set(cle, r)
}

for (const r of remises.values()) {
  const mois = moisPrecedent(r.dateExec)
  const { data: deja } = await supabase.from('sct_export').select('id').eq('agence', AGENCE)
    .eq('type_export', 'detail_remise_ce').eq('msg_id', `CE_${r.dateExec}_${r.totalCts}`).maybeSingle()
  if (deja) { console.log(`${r.dateExec} ${r.totalCts / 100} € : déjà importée`); continue }
  const { data: factures } = await supabase.from('facture_evoliz')
    .select('id, montant_reversement, proprietaire_id, proprietaire:proprietaire_id(nom, prenom, bic)')
    .eq('agence', AGENCE).eq('type_facture', 'honoraires').eq('mois', mois).gt('montant_reversement', 0)
  const { data: proprios } = await supabase.from('proprietaire').select('id, nom, prenom, iban').eq('agence', AGENCE)
  const parIban = new Map((proprios || []).filter(p => p.iban).map(p => [p.iban.replace(/\s/g, '').toUpperCase(), p]))
  const prises = new Set()
  const lignes = r.lignes.map(l => {
    // 1) IBAN imprimé par la banque = identification certaine du propriétaire
    const pIban = l.iban ? parIban.get(l.iban.toUpperCase()) : null
    if (pIban) {
      const siennes = (factures || []).filter(f => f.proprietaire_id === pIban.id && !prises.has(f.id))
      const exacte = siennes.find(f => f.montant_reversement === l.montant_cts)
      const f = exacte || (siennes.length === 1 ? siennes[0] : null)
      if (f) prises.add(f.id)
      return { l, f, proprio: pIban, rattachement: f ? (exacte ? 'iban' : `iban (facture ${(f.montant_reversement / 100).toFixed(2)} €, écart ${((f.montant_reversement - l.montant_cts) / 100).toFixed(2)} €)`) : 'iban (sans facture ce mois)' }
    }
    const libres = (factures || []).filter(f => !prises.has(f.id))
    const parNom = l.nom ? libres.filter(f => f.montant_reversement === l.montant_cts &&
      norm(l.nom).split(' ').some(w => w.length >= 4 && norm(f.proprietaire?.nom).includes(w))) : []
    const parMontant = libres.filter(f => f.montant_reversement === l.montant_cts)
    let f = parNom.length === 1 ? parNom[0] : (parMontant.length === 1 ? parMontant[0] : null)
    let rattachement = f ? (parNom.length === 1 ? 'nom' : 'montant') : 'aucun'
    return { l, f, proprio: null, rattachement }
  })
  for (const x of lignes) if (x.f) prises.add(x.f.id)
  // 2e passe : facture régénérée APRÈS le virement (montant changé — ex. juin 2026, FMEN réel) →
  // même banque (BIC 8 caractères) et montant le plus proche parmi les factures restantes
  for (const x of lignes.filter(x => !x.f).sort((a, b) => b.l.montant_cts - a.l.montant_cts)) {
    const bic8 = x.l.bic.slice(0, 8)
    const cands = (factures || []).filter(f => !prises.has(f.id) && (f.proprietaire?.bic || '').toUpperCase().replace(/\s/g, '').slice(0, 8) === bic8)
      .map(f => ({ f, ecart: Math.abs(f.montant_reversement - x.l.montant_cts) }))
      .filter(c => c.ecart <= Math.max(5000, x.l.montant_cts * 0.25)).sort((a, b) => a.ecart - b.ecart)
    if (cands.length && (cands.length === 1 || cands[1].ecart - cands[0].ecart > 2000)) {
      x.f = cands[0].f; x.rattachement = `bic_montant_proche (écart ${(cands[0].ecart / 100).toFixed(2)} €)`; prises.add(x.f.id)
    }
  }
  const lignesOut = lignes.map(({ l, f, proprio, rattachement }) => ({ cle: f?.id || null, montant_cts: l.montant_cts,
    proprietaire_id: proprio?.id || f?.proprietaire_id || null,
    nom: l.nom || [proprio?.nom || f?.proprietaire?.nom, proprio?.prenom || f?.proprietaire?.prenom].filter(Boolean).join(' ') || null,
    label: l.motif, rang: l.rang, bic: l.bic, iban: l.iban, rattachement }))
  const nonLiees = lignesOut.filter(l => !l.cle && !l.proprietaire_id)
  console.log(`${r.dateExec} (factures ${mois}) ${r.totalCts / 100} € — ${lignesOut.length} lignes, ${lignesOut.length - nonLiees.length} rattachées${nonLiees.length ? ` ; NON rattachées : ${nonLiees.map(l => `#${l.rang} ${l.montant_cts / 100} ${l.bic}`).join(', ')}` : ''}`)
  for (const l of lignesOut.filter(l => l.rattachement !== 'iban' && l.rattachement !== 'montant' && l.rattachement !== 'nom')) console.log(`   ~ #${l.rang} ${l.montant_cts / 100} → ${l.nom} [${l.rattachement}]`)
  if (dry) continue
  const { error } = await supabase.from('sct_export').insert({ agence: AGENCE, mois, type_export: 'detail_remise_ce',
    msg_id: `CE_${r.dateExec}_${r.totalCts}`, total_cts: r.totalCts, nb: lignesOut.length, lignes: lignesOut, cree_par: 'import-detail-remise' })
  if (error) throw error
}
