import { supabase } from '../lib/supabase.js'
import { AGENCE } from '../lib/agence.js'

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

const fp = r => `${r.date_operation}|${r.debit ?? ''}|${r.credit ?? ''}|${r.libelle ?? ''}`

export async function importerMouvementsLLD(rows, compte, agence = AGENCE) {
  if (!rows.length) return 0

  // Plage de dates du fichier
  const dates = rows.map(r => r.date_operation).filter(Boolean).sort()
  const dateMin = dates[0], dateMax = dates[dates.length - 1]

  // Récupérer TOUS les existants sur cette plage (évite les .in() avec trop de valeurs)
  const { data: existants, error: fetchErr } = await supabase
    .from('lld_mouvement_bancaire')
    .select('date_operation,debit,credit,libelle,numero_operation')
    .eq('agence', agence).eq('compte', compte)
    .gte('date_operation', dateMin).lte('date_operation', dateMax)
  if (fetchErr) throw fetchErr

  const numExistants = new Set((existants || []).filter(r => r.numero_operation).map(r => r.numero_operation))
  const fpExistants  = new Set((existants || []).filter(r => !r.numero_operation).map(fp))

  // Dédupliquer le fichier lui-même (une seule entrée par clé)
  const vus = new Map()
  for (const r of rows) {
    const key = r.numero_operation || fp(r)
    if (!vus.has(key)) vus.set(key, r)
  }

  // Filtrer ceux qui existent déjà en base
  const nouveaux = [...vus.values()]
    .filter(r => r.numero_operation ? !numExistants.has(r.numero_operation) : !fpExistants.has(fp(r)))
    .map(r => ({ agence, compte, ...r, statut: 'non_rapproche' }))

  if (!nouveaux.length) return 0

  // Upsert pour les lignes à numero_operation : le filtre ci-dessus ne voit que les
  // existants DANS la plage de dates du fichier — un même numero_operation déjà en base
  // avec une date hors plage faisait exploser l'insert sur la contrainte
  // (numero_operation, compte, agence). ignore-duplicates = réimport toujours idempotent.
  const avecNum = nouveaux.filter(r => r.numero_operation)
  const sansNum = nouveaux.filter(r => !r.numero_operation)
  if (avecNum.length) {
    const { error } = await supabase.from('lld_mouvement_bancaire')
      .upsert(avecNum, { onConflict: 'numero_operation,compte,agence', ignoreDuplicates: true })
    if (error) throw error
  }
  if (sansNum.length) {
    const { error } = await supabase.from('lld_mouvement_bancaire').insert(sansNum)
    if (error) throw error
  }
  return nouveaux.length
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

export async function listerTousMouvementsLLD(compte, agence = AGENCE) {
  const { data, error } = await supabase
    .from('lld_mouvement_bancaire')
    .select('*, etudiant(id, nom, prenom)')
    .eq('agence', agence)
    .eq('compte', compte)
    .order('date_operation', { ascending: false })
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

// ── Mise à jour loyer_suivi depuis mouvements rapprochés ──────────────────────
// Pour chaque mouvement rapproché (compte=loyers, credit>0), marque le loyer
// correspondant comme reçu. N'envoie aucun email ni quittance.
// Matching automatique DB-side : associe les mouvements non liés aux étudiants par nom/prénom
// Appelable depuis n'importe quelle page (ne dépend pas de l'état React)
export async function autoMatcherMouvementsLLD(agence = AGENCE) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const [{ data: mvts }, { data: etudiants }] = await Promise.all([
    supabase
      .from('lld_mouvement_bancaire')
      .select('id, libelle, detail, credit, compte')
      .eq('agence', agence)
      .eq('statut', 'non_rapproche')
      .is('etudiant_id', null),
    supabase
      .from('etudiant')
      .select('id, nom, prenom, caution, loyer_nu, bien(code)')
      .eq('agence', agence),
  ])

  if (!mvts?.length || !etudiants?.length) return { lies: 0 }

  let lies = 0
  for (const m of mvts) {
    const haystack = norm(`${m.libelle || ''} ${m.detail || ''}`)
    let match = etudiants.find(e => {
      if (!norm(e.nom) || !haystack.includes(norm(e.nom))) return false
      if (e.prenom) return haystack.includes(norm(e.prenom))
      return true
    })
    if (!match) {
      const candidats = etudiants.filter(e => e.bien?.code && haystack.includes(norm(e.bien.code)))
      if (candidats.length === 1) match = candidats[0]
    }
    if (!match && m.credit) {
      // Matching par montant : caution uniquement pour compte cautions, loyer_nu pour compte loyers
      const candidats = m.compte === 'cautions'
        ? etudiants.filter(e => e.caution === m.credit)
        : etudiants.filter(e => e.loyer_nu === m.credit)
      if (candidats.length === 1) match = candidats[0]
    }
    if (match) {
      const { error } = await supabase
        .from('lld_mouvement_bancaire')
        .update({ etudiant_id: match.id, statut: 'rapproche' })
        .eq('id', m.id)
      if (!error) lies++
    }
  }
  return { lies }
}

export async function autoMatcherVirementsProprioLLD(agence = AGENCE) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const [{ data: mvts }, { data: virements }] = await Promise.all([
    supabase
      .from('lld_mouvement_bancaire')
      .select('id, libelle, detail, debit, date_operation')
      .eq('agence', agence)
      .eq('statut', 'non_rapproche')
      .not('debit', 'is', null)
      .gt('debit', 0),
    supabase
      .from('virement_proprio_suivi')
      .select('id, montant, etudiant:etudiant_id(proprietaire:proprietaire_id(nom, prenom))')
      .eq('agence', agence)
      .eq('statut', 'a_virer'),
  ])

  if (!mvts?.length || !virements?.length) return { lies: 0 }

  let lies = 0
  for (const m of mvts) {
    const haystack = norm(`${m.libelle || ''} ${m.detail || ''}`)
    // Match : montant exact + nom du propriétaire dans le libellé
    const candidats = virements.filter(v => {
      if (v.montant !== m.debit) return false
      const propNom = norm(v.etudiant?.proprietaire?.nom || '')
      return propNom && haystack.includes(propNom)
    })
    if (candidats.length === 1) {
      const v = candidats[0]
      const [e1, e2] = await Promise.all([
        supabase.from('virement_proprio_suivi')
          .update({ statut: 'vire', date_virement: m.date_operation })
          .eq('id', v.id)
          .then(r => r.error),
        supabase.from('lld_mouvement_bancaire')
          .update({ statut: 'rapproche' })
          .eq('id', m.id)
          .then(r => r.error),
      ])
      if (!e1 && !e2) lies++
    }
  }
  return { lies }
}

// ── Contrôle de trésorerie LLD ────────────────────────────────────────────────
// Pour un mois donné, vérifie que les loyers marqués "reçu" sont PROUVÉS en banque,
// c.-à-d. adossés à un mouvement crédit rapproché sur le séquestre loyers LLD
// (compte='loyers', statut='rapproche', mois_releve=mois). Même sémantique que
// majLoyersDepuisVirements. Un loyer "reçu" sans mouvement rapproché = sans preuve
// (marqué reçu à la main sans rapprochement bancaire → à creuser).
export async function controleTresorerieLLD(mois, agence = AGENCE) {
  const [{ data: loyers, error: e1 }, { data: mvts, error: e2 }] = await Promise.all([
    supabase
      .from('loyer_suivi')
      .select('id, etudiant_id, montant_recu, etudiant(nom, prenom, bien:bien_id(code))')
      .eq('agence', agence).eq('mois', mois).eq('statut', 'recu'),
    supabase
      .from('lld_mouvement_bancaire')
      .select('etudiant_id, credit')
      .eq('agence', agence).eq('compte', 'loyers').eq('statut', 'rapproche')
      .eq('mois_releve', mois).gt('credit', 0),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const prouvesSet = new Set((mvts || []).filter(m => m.etudiant_id).map(m => m.etudiant_id))
  const recus = loyers || []
  const prouves = recus.filter(l => l.etudiant_id && prouvesSet.has(l.etudiant_id))
  const sansPreuve = recus.filter(l => !(l.etudiant_id && prouvesSet.has(l.etudiant_id)))
  const sum = arr => arr.reduce((s, l) => s + (l.montant_recu || 0), 0)

  return {
    nbRecus: recus.length,
    montantRecu: sum(recus),
    nbProuves: prouves.length,
    montantProuve: sum(prouves),
    nbSansPreuve: sansPreuve.length,
    montantSansPreuve: sum(sansPreuve),
    montantBanque: (mvts || []).reduce((s, m) => s + (m.credit || 0), 0),
    sansPreuve: sansPreuve.map(l => ({
      nom: l.etudiant?.nom || '—',
      prenom: l.etudiant?.prenom || '',
      bien: l.etudiant?.bien?.code || '—',
      montant: l.montant_recu || 0,
    })),
  }
}

export async function majLoyersDepuisVirements(agence = AGENCE) {
  // 1. Récupérer tous les mouvements rapprochés crédits sur le compte loyers
  const { data: mvts, error: errMvts } = await supabase
    .from('lld_mouvement_bancaire')
    .select('id, etudiant_id, mois_releve, credit, date_operation')
    .eq('agence', agence)
    .eq('compte', 'loyers')
    .eq('statut', 'rapproche')
    .gt('credit', 0)
  if (errMvts) throw errMvts

  if (!mvts?.length) return { updated: 0, skipped: 0 }

  // 2. Pour chaque mouvement, mettre à jour le loyer_suivi correspondant
  let updated = 0, skipped = 0
  for (const m of mvts) {
    if (!m.etudiant_id || !m.mois_releve) { skipped++; continue }

    // Chercher le loyer_suivi (attendu ou en_retard seulement)
    const { data: loyer } = await supabase
      .from('loyer_suivi')
      .select('id, statut')
      .eq('agence', agence)
      .eq('etudiant_id', m.etudiant_id)
      .eq('mois', m.mois_releve)
      .in('statut', ['attendu', 'en_retard'])
      .maybeSingle()

    if (!loyer) { skipped++; continue }

    const { error } = await supabase
      .from('loyer_suivi')
      .update({ statut: 'recu', montant_recu: m.credit, date_reception: m.date_operation })
      .eq('id', loyer.id)

    if (!error) updated++
    else skipped++
  }

  return { updated, skipped }
}
