/**
 * Service d'import du relevé bancaire Caisse d'Épargne
 * Format CSV : ISO-8859-1, séparateur ;
 * Colonnes : Date ; N° opération ; Libellé ; Débit ; Crédit ; Détail
 */

import { supabase } from '../lib/supabase'
import { AGENCE } from '../lib/agence'

/**
 * Parse un fichier CSV Caisse d'Épargne
 * @param {File} file - Fichier CSV uploadé
 * @returns {Promise<Array>} Lignes parsées
 */
export async function parseCSVCaisseEpargne(file) {
  // Lire en ISO-8859-1
  const buffer = await file.arrayBuffer()
  const decoder = new TextDecoder('iso-8859-1')
  const text = decoder.decode(buffer)

  const lines = text.split(/\r?\n/).filter(l => l.trim())

  // Extraire le mois depuis l'entête
  // "Date de début de téléchargement : 01/02/2026"
  let moisReleve = null
  const dateMatch = text.match(/Date de d[eé]but.*?(\d{2})\/(\d{2})\/(\d{4})/)
  if (dateMatch) {
    moisReleve = `${dateMatch[3]}-${dateMatch[2]}`
  }

  const mouvements = []

  for (const line of lines) {
    const cols = line.split(';').map(c => c.trim().replace(/^"|"$/g, ''))

    // Ignorer les lignes non-données (entêtes, totaux, lignes vides)
    if (cols.length < 5) continue
    if (!cols[0].match(/^\d{2}\/\d{2}\/\d{2}$/)) continue

    const [dateStr, numOp, libelle, debit, credit, detail] = cols

    // Parser la date DD/MM/YY → YYYY-MM-DD
    const [dd, mm, yy] = dateStr.split('/')
    const year = parseInt(yy) + 2000
    const dateOperation = `${year}-${mm}-${dd}`

    // Parser les montants (virgule → point, enlever +/-)
    const parseAmount = (str) => {
      if (!str || str === '') return null
      const cleaned = str.replace(',', '.').replace(/[+\s]/g, '')
      const val = parseFloat(cleaned)
      if (isNaN(val)) return null
      return Math.round(Math.abs(val) * 100) // Centimes, toujours positif
    }

    const debitCentimes = parseAmount(debit)
    const creditCentimes = parseAmount(credit)

    // Ignorer les virements test Airbnb (≤ 5 centimes)
    if (creditCentimes !== null && creditCentimes <= 5 && libelle.includes('AIRBNB')) continue

    mouvements.push({
      date_operation: dateOperation,
      numero_operation: numOp || null,
      libelle: libelle,
      detail: detail?.trim() || null,
      debit: debitCentimes,
      credit: creditCentimes,
      canal: detecterCanal(libelle, detail),
      source: 'csv',
      mois_releve: moisReleve || dateOperation.substring(0, 7),
      statut_matching: 'en_attente',
    })
  }

  return mouvements
}

/**
 * Détecte automatiquement le canal d'un mouvement
 * basé sur les patterns du libellé et du détail
 */
function detecterCanal(libelle, detail) {
  const lib = (libelle || '').toUpperCase()
  const det = (detail || '').toUpperCase()

  if (lib.includes('AIRBNB PAYMENTS')) return 'airbnb'
  if (lib.includes('BOOKING.COM')) return 'booking'
  if (lib.includes('STRIPE TECHNOLOGY')) return 'stripe'
  if (lib.includes('FRAIS STRIPE')) return 'interne'
  if (lib.includes('DESTINATION') && lib.includes('BASQUE')) return 'interne'

  // Virements sortants
  if (lib.includes('HONORAIRES')) return 'sortant_honoraires'
  if (lib.includes('LOYERS') || lib.includes('LOCATIONS') || lib.includes('LOYER')) return 'sortant_proprio'
  if (lib.includes('MENAGES') || lib.includes('MENAGE')) return 'sortant_ae'
  if (lib.includes('COMM DISTRIBUTION')) return 'sortant_honoraires'
  if (lib.includes('FRAIS DE TENUE')) return 'frais_bancaires'
  if (lib.includes('RETOUR VIREMENT')) return 'interne'

  return 'sepa_manuel'
}

/**
 * Importe les mouvements parsés dans Supabase
 * Évite les doublons via numero_operation
 *
 * @param {Array} mouvements - Mouvements parsés
 * @returns {Promise<{inserted, skipped}>}
 */
export async function importerMouvements(mouvements) {
  if (!mouvements || mouvements.length === 0) return { inserted: 0, skipped: 0 }

  const moisReleve = mouvements[0]?.mois_releve

  // Récupérer les N° opération déjà importés pour ce mois
  const { data: existing } = await supabase
    .from('mouvement_bancaire')
    .select('numero_operation')
    .eq('mois_releve', moisReleve)
    .eq('agence', AGENCE)

  const existingNums = new Set((existing || []).map(m => m.numero_operation).filter(Boolean))

  // Filtrer les nouveaux
  const toInsert = mouvements.filter(m =>
    !m.numero_operation || !existingNums.has(m.numero_operation)
  )

  if (toInsert.length === 0) return { inserted: 0, skipped: mouvements.length }

  const { error } = await supabase.from('mouvement_bancaire').insert(toInsert.map(m => ({ ...m, agence: AGENCE })))
  if (error) throw error

  // Logger
  await supabase.from('import_log').insert({
    type: 'csv_bancaire',
    mois_concerne: moisReleve,
    statut: 'success',
    nb_lignes_traitees: mouvements.length,
    nb_lignes_creees: toInsert.length,
    nb_lignes_mises_a_jour: 0,
    message: `Import CSV CE ${moisReleve} — ${toInsert.length} mouvements insérés, ${mouvements.length - toInsert.length} ignorés (doublons)`,
  })

  return { inserted: toInsert.length, skipped: mouvements.length - toInsert.length }
}

/**
 * Récupère les mouvements d'un mois depuis Supabase
 */
export async function getMouvementsMois(mois) {
  const { data, error } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
    .eq('agence', AGENCE)
    .order('date_operation', { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Récupère les mouvements en attente de rapprochement (crédits uniquement)
 */
export async function getMouvementsARapprocher(mois) {
  const { data, error } = await supabase
    .from('mouvement_bancaire')
    .select('*')
    .eq('mois_releve', mois)
    .eq('agence', AGENCE)
    .eq('statut_matching', 'en_attente')
    .not('credit', 'is', null)
    .order('date_operation')

  if (error) throw error
  return data || []
}

/**
 * Retourne la liste des mois ayant des mouvements en base
 */
export async function getMoisDispos() {
  const { data, error } = await supabase
    .from('mouvement_bancaire')
    .select('mois_releve')
    .eq('agence', AGENCE)
    .order('mois_releve', { ascending: false })
  if (error) throw new Error(error.message)
  const seen = new Set()
  for (const row of (data || [])) seen.add(row.mois_releve)
  // Toujours inclure le mois courant
  const courant = new Date().toISOString().substring(0, 7)
  seen.add(courant)
  return [...seen].sort((a, b) => b.localeCompare(a))
}
