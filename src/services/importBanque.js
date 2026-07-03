import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

export function detecterFormatCSV(texte) {
  const lignes = texte.split('\n').slice(0, 10).map(l => l.toLowerCase())
  if (lignes[0].includes('transaction id') || lignes[0].includes('date de la valeur')) return 'budgetbakers'
  if (lignes[0].includes('code de la banque') || lignes[0].includes('numéro de compte') || lignes[0].includes('numero de compte')) return 'caisse_epargne'
  if (lignes.some(l => l.startsWith('date;') && (l.includes('débit') || l.includes('debit')))) return 'caisse_epargne'
  // Nouveau format banque : Date comptable;Libelle simplifie;Reference;Informations complementaires;...
  if (lignes[0].includes('libelle simplifie') || lignes[0].includes('date comptable') || lignes[0].includes('informations complementaires')) return 'caisse_epargne'
  return 'inconnu'
}

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
  const v = parseFloat(str.trim().replace(/"/g,'').replace(/\s/g,'').replace(',','.').replace(/[+]/g,''))
  if (isNaN(v) || v === 0) return null
  return Math.round(Math.abs(v) * 100)
}

function detectCanal(lib, det, debit) {
  // Texte normalisé (minuscules + sans accents) pour matcher "reversée", "propriétaire", etc.
  const l = ((lib || '') + ' ' + (det || '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  // Plateformes
  if (l.includes('airbnb')) return 'airbnb'
  if (l.includes('stripe technology') || l.includes('stripe payments')) return 'stripe'
  if (l.includes('booking')) return 'booking'

  // --- Mouvements hors périmètre résa (crédit OU débit) ---
  // ⚠️ NE PAS utiliser "Destination cote basque" comme signal interne : ce nom apparaît
  // comme "Creditor Name SEPA : Destination cote basque" sur TOUT virement entrant
  // (DCB est toujours le bénéficiaire) → ce sont des paiements voyageurs réels.
  // On ne classe en interne que sur des marqueurs sans ambiguïté.
  // Transferts entre comptes DCB
  if (l.includes('compte principal') ||
      l.includes('changement de banque') ||
      l.includes('transfert compte') || l.includes('transfert de compte')) return 'interne'
  // Retour / rejet / régularisation de virement
  if (l.includes('retour virement') || l.includes('rejet virement') ||
      l.includes('virement non execute') || l.includes('regul virement')) return 'interne'
  // Reversement de débours / main d'œuvre par le propriétaire vers le séquestre
  // + remboursements de débours AE par les proprios (libellés « Debours AE Viky 2026 05 »,
  //   « DEBOURS-AE-AITA-2026-05 »…) — pas des payins résa, hors périmètre rapprochement
  if (l.includes('reverse par le proprietaire') || l.includes('reversee par le proprietaire') ||
      l.includes('debours ae') || l.includes('debours-ae') ||
      (l.includes('sequestre') && l.includes('main d'))) return 'interne'
  // Frais bancaires (tenue de compte, cotisation, frais Stripe)
  if (l.includes('frais de tenue') || l.includes('frais tenue') || l.includes('cotisation') ||
      l.includes('frais stripe')) return 'frais_bancaires'

  if (debit > 0) {
    const u = (lib || '').toUpperCase()
    if (['PROPRIO','LOYER','LOCATION'].some(x => u.includes(x))) return 'sortant_proprio'
    if (u.includes('HONORAIRE')) return 'sortant_honoraires'
    if (['FRAIS','COMMISSION','ABONNEMENT'].some(x => u.includes(x))) return 'frais_bancaires'
    if (u.includes(' AE') || u.includes('AUTO-ENTREPRENEUR')) return 'sortant_ae'
    return 'interne'
  }
  return 'sepa_manuel'
}

function splitCSVLine(line) {
  const cols = []; let cur = '', inQ = false
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue }
    if (c === ';' && !inQ) { cols.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  cols.push(cur.trim())
  return cols
}

function parserLignes(lignes, iDate, iNum, iLib, iDet, iDebit, iCredit, source) {
  const rows = []
  for (const cols of lignes.slice(1)) {
    if (cols.length < 4) continue
    const dateOp = parseDate(cols[iDate] || '')
    if (!dateOp) continue
    const debit = parseMontant(cols[iDebit] || '0')
    const credit = parseMontant(cols[iCredit] || '0')
    const lib = (cols[iLib] || '').slice(0, 200)
    const det = (iDet >= 0 ? cols[iDet] || '' : '').slice(0, 200)
    const numOp = (iNum >= 0 && cols[iNum]) ? cols[iNum].trim() : null
    // Clé synthétique déterministe quand le numéro de référence est absent
    // Empêche les doublons lors des re-imports (NULL n'est pas unique en Postgres)
    const numeroOperation = numOp || `${source}_${dateOp}_${lib.slice(0, 40)}_${debit || 0}_${credit || 0}`
    rows.push({
      numero_operation: numeroOperation,
      date_operation: dateOp, libelle: lib, detail: det,
      debit: debit || null, credit: credit || null,
      canal: detectCanal(lib, det, debit || 0),
      source, mois_releve: dateOp.slice(0, 7), statut_matching: 'en_attente',
    })
  }
  return rows
}

export function parserBudgetBakers(texte) {
  const lignes = texte.replace(/\r/g, '').split('\n').map(splitCSVLine)
  const h = lignes[0].map(x => x.toLowerCase().trim())
  const find = (...terms) => h.findIndex(x => terms.some(t => x.includes(t)))
  return parserLignes(lignes,
    find("date d'op", "date d op", "date d'opération"),
    find('transaction id'), find('libellé', 'libelle'),
    find('contrepartie', 'nom de la'),
    find('débit', 'debit'), find('crédit', 'credit'), 'BudgetBakers')
}

export function parserCaisseEpargne(texte) {
  const toutesLignes = texte.replace(/\r/g, '').split('\n').map(splitCSVLine)
  // Trouver la ligne d en-tete (date + debit + credit)
  const idxHeader = toutesLignes.findIndex(cols => {
    const row = cols.join(';').toLowerCase()
    return row.includes('date') && (row.includes('débit') || row.includes('debit')) && (row.includes('crédit') || row.includes('credit'))
  })
  const lignes = idxHeader >= 0 ? toutesLignes.slice(idxHeader) : toutesLignes
  const h = lignes[0].map(x => x.toLowerCase().trim())
  const find = (...terms) => h.findIndex(x => terms.some(t => x.includes(t)))
  return parserLignes(lignes,
    find('date'),
    find('numéro', 'numero', 'référence', 'reference'),
    find('libellé', 'libelle'),
    find('détail', 'detail', 'informations'),
    find('débit', 'debit'),
    find('crédit', 'credit'),
    'CaisseEpargne')
}

export async function parserFichierBancaire(file) {
  // Lire en ArrayBuffer pour gérer l'encodage
  const buf = await file.arrayBuffer()
  // Essayer UTF-8, si trop de caractères invalides → latin-1 (Caisse Epargne)
  let texte = new TextDecoder('utf-8').decode(buf)
  if ((texte.match(/\uFFFD/g) || []).length > 5) {
    texte = new TextDecoder('iso-8859-1').decode(buf)
  }

  const format = detecterFormatCSV(texte)
  let rows = []
  if (format === 'budgetbakers') rows = parserBudgetBakers(texte)
  else if (format === 'caisse_epargne') rows = parserCaisseEpargne(texte)
  else throw new Error('Format CSV non reconnu. Formats supportes: BudgetBakers, Caisse Epargne.')

  const moisCount = {}
  for (const r of rows) moisCount[r.mois_releve] = (moisCount[r.mois_releve] || 0) + 1
  const mois_disponibles = Object.entries(moisCount)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([mois, count]) => ({ mois, count }))
  return { format, rows, mois_disponibles, total: rows.length }
}

export async function importerMouvementsBancaires(rows, moisSelectionnes) {
  const aImporter = moisSelectionnes
    ? rows.filter(r => moisSelectionnes.includes(r.mois_releve))
    : rows
  const log = { inseres: 0, ignores: 0, erreurs: 0 }
  if (aImporter.length === 0) return log
  const BATCH = 100
  for (let i = 0; i < aImporter.length; i += BATCH) {
    const batch = aImporter.slice(i, i + BATCH)
    const { error } = await supabase.from('mouvement_bancaire').upsert(batch.map(m => ({ ...m, agence: AGENCE })), { onConflict: 'numero_operation', ignoreDuplicates: true })
    if (error) {
      if (error.code === '23505') { log.ignores += batch.length }
      else { log.erreurs += batch.length; console.error('Import batch:', error.message) }
    } else { log.inseres += batch.length }
  }
  return log
}
