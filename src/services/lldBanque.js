import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

// ── Parsing CSV Caisse d'Épargne ──────────────────────────────────────────────

function parseDate(str) {
  if (!str) return null
  str = str.trim().replace(/"/g, '')
  const m4 = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m4) return m4[3] + '-' + m4[2] + '-' + m4[1]
  const m2 = str.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (m2) return '20' + m2[3] + '-' + m2[2] + '-' + m2[1]
  return null
}

function parseMontant(str) {
  if (!str) return null
  const v = parseFloat(str.trim().replace(/"/g, '').replace(/\s/g, '').replace(',', '.').replace(/[+]/g, ''))
  if (isNaN(v) || v === 0) return null
  return Math.round(Math.abs(v) * 100)
}

function splitCSVLine(line, sep) {
  const cols = []; let cur = '', inQ = false
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue }
    if (c === sep && !inQ) { cols.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  cols.push(cur.trim())
  return cols
}

function detectSep(firstLine) {
  const tabs = (firstLine.match(/\t/g) || []).length
  const semis = (firstLine.match(/;/g) || []).length
  return tabs >= semis ? '\t' : ';'
}

export function parserCSVCaisseEpargne(texte) {
  const rawLines = texte.replace(/\r/g, '').split('\n').filter(l => l.trim())
  const sep = detectSep(rawLines[0] || '')
  const lignes = rawLines.map(l => splitCSVLine(l, sep))
  // Trouver la ligne d'en-tête (ignorer les lignes d'info compte)
  const hi = lignes.findIndex(row => row.some(c => /date/i.test(c.trim())))
  if (hi < 0) throw new Error('En-tête CSV non trouvée — vérifiez le format du fichier')
  const h = lignes[hi].map(x => x.toLowerCase().trim())
  const find = (...terms) => h.findIndex(x => terms.some(t => x.includes(t)))
  // "Date operation" préféré sur "Date comptable" pour la date réelle
  const iDateOp   = find('date operation', 'date_operation')
  const iDate     = iDateOp >= 0 ? iDateOp : find('date')
  const iNum      = find('référence', 'reference', 'numéro', 'numero', 'n°')
  const iLib      = find('libellé', 'libelle')
  const iDet      = find('informations', 'détail', 'detail', 'complément', 'complement')
  const iDebit    = find('débit', 'debit')
  const iCredit   = find('crédit', 'credit')

  const rows = []
  for (const cols of lignes.slice(hi + 1)) {
    if (cols.length < 3) continue
    const dateOp = parseDate(cols[iDate] || '')
    if (!dateOp) continue
    const debit  = parseMontant(iDebit  >= 0 ? cols[iDebit]  || '' : '')
    const credit = parseMontant(iCredit >= 0 ? cols[iCredit] || '' : '')
    if (!debit && !credit) continue
    const lib = (cols[iLib] || '').slice(0, 200)
    const det = (iDet >= 0 ? cols[iDet] || '' : '').slice(0, 200)
    const num = (iNum >= 0 ? cols[iNum] || '' : '').trim() || null
    rows.push({
      date_operation:  dateOp,
      libelle:         lib,
      detail:          det,
      debit:           debit  || null,
      credit:          credit || null,
      numero_operation: num,
      mois_releve:     dateOp.slice(0, 7),
    })
  }
  return rows
}

export async function parserFichierLLD(file) {
  const buf  = await file.arrayBuffer()
  const texte = new TextDecoder('iso-8859-1').decode(buf)
  const rows  = parserCSVCaisseEpargne(texte)
  const moisDispos = [...new Set(rows.map(r => r.mois_releve))].filter(Boolean).sort()
  return { rows, moisDispos, total: rows.length }
}

// ── Import en base ─────────────────────────────────────────────────────────────

export async function importerMouvementsLLD(rows, compte, agence = AGENCE) {
  if (!rows.length) return 0
  const toInsert = rows.map(r => ({ agence, compte, ...r, statut: 'non_rapproche' }))
  // Déduplication interne au fichier avant upsert
  const avecNumMap = new Map()
  for (const r of toInsert.filter(r => r.numero_operation)) avecNumMap.set(r.numero_operation, r)
  const avecNum = [...avecNumMap.values()]
  const sansNum  = toInsert.filter(r => !r.numero_operation)
  let total = 0

  if (avecNum.length) {
    const { error } = await supabase
      .from('lld_mouvement_bancaire')
      .upsert(avecNum, { onConflict: 'numero_operation,compte,agence', ignoreDuplicates: true })
    if (error) throw error
    total += avecNum.length
  }

  if (sansNum.length) {
    // Déduplication manuelle : on récupère les existants sur les mois concernés
    const moisConcernes = [...new Set(sansNum.map(r => r.mois_releve))].filter(Boolean)
    const { data: existants } = await supabase
      .from('lld_mouvement_bancaire')
      .select('date_operation,debit,credit,libelle')
      .eq('agence', agence).eq('compte', compte)
      .is('numero_operation', null)
      .in('mois_releve', moisConcernes)
    const empreintes = new Set((existants || []).map(r => `${r.date_operation}|${r.debit}|${r.credit}|${r.libelle}`))
    const nouveaux = sansNum.filter(r => !empreintes.has(`${r.date_operation}|${r.debit}|${r.credit}|${r.libelle}`))
    if (nouveaux.length) {
      const { error } = await supabase.from('lld_mouvement_bancaire').insert(nouveaux)
      if (error) throw error
      total += nouveaux.length
    }
  }

  return total
}

// ── Lecture ────────────────────────────────────────────────────────────────────

export async function listerMouvementsLLD(compte, mois, agence = AGENCE) {
  const { data, error } = await supabase
    .from('lld_mouvement_bancaire')
    .select('*, etudiant(id, nom, prenom)')
    .eq('agence', agence)
    .eq('compte', compte)
    .eq('mois_releve', mois)
    .order('date_operation')
  if (error) throw error
  return data || []
}

export async function listerMoisDisposLLD(compte, agence = AGENCE) {
  const { data, error } = await supabase
    .from('lld_mouvement_bancaire')
    .select('mois_releve')
    .eq('agence', agence)
    .eq('compte', compte)
    .order('mois_releve', { ascending: false })
  if (error) throw error
  return [...new Set((data || []).map(r => r.mois_releve))]
}

export async function supprimerMouvementLLD(id) {
  const { error } = await supabase.from('lld_mouvement_bancaire').delete().eq('id', id)
  if (error) throw error
}

export async function mettreAJourMouvementLLD(id, payload) {
  const { error } = await supabase.from('lld_mouvement_bancaire').update(payload).eq('id', id)
  if (error) throw error
}
