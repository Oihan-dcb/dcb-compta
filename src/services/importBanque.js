import { supabase } from '../lib/supabase'

export function detecterFormatCSV(texte) {
  const lignes = texte.split('\n').slice(0, 10).map(l => l.toLowerCase())
  // BudgetBakers : premiere ligne avec Transaction ID
  if (lignes[0].includes('transaction id') || lignes[0].includes('date de la valeur')) return 'budgetbakers'
  // Caisse Epargne : commence par "code de la banque" ou contient "numero d operation" dans les 10 premieres lignes
  if (lignes[0].includes('code de la banque') || lignes[0].includes('numéro de compte')) return 'caisse_epargne'
  if (lignes.some(l => l.includes("numéro d'opération") || l.includes('numero d operation') || (l.startsWith('date;') && l.includes('débit')))) return 'caisse_epargne'
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
  const l = ((lib || '') + ' ' + (det || '')).toLowerCase()
  if (l.includes('airbnb')) return 'airbnb'
  if (l.includes('stripe')) return 'stripe'
  if (l.includes('booking')) return 'booking'
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
    rows.push({
      numero_operation: (iNum >= 0 && cols[iNum]) ? cols[iNum] : undefined,
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
  // Trouver la ligne d en-tete (celle qui contient Date et Debit)
  const idxHeader = toutesLignes.findIndex(cols => {
    const row = cols.join(';').toLowerCase()
    return (row.includes('date') && (row.includes('débit') || row.includes('debit'))) &&
           (row.includes('crédit') || row.includes('credit'))
  })
  const lignes = idxHeader >= 0 ? toutesLignes.slice(idxHeader) : toutesLignes
  const h = lignes[0].map(x => x.toLowerCase().trim())
  const find = (...terms) => h.findIndex(x => terms.some(t => x.includes(t)))
  return parserLignes(lignes,
    find('date'),
    find('numéro', 'numero'),
    find('libellé', 'libelle'),
    find('détail', 'detail'),
    find('débit', 'debit'),
    find('crédit', 'credit'),
    'CaisseEpargne')
}


