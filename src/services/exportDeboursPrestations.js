import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { AGENCE } from '../lib/agence'

async function fetchData(mois, bienIds = null) {
  let prestQuery = supabase.from('prestation_hors_forfait')
    .select('*, bien:bien_id!inner(code, hospitable_name, agence), prestation_type:prestation_type_id(nom), auto_entrepreneur:ae_id(prenom, nom)')
    .eq('mois', mois)
    .eq('bien.agence', AGENCE)
    .order('date_prestation', { ascending: true })
  if (bienIds) prestQuery = prestQuery.in('bien_id', bienIds)
  let fraisQuery = supabase.from('frais_proprietaire')
    .select('*, proprietaire:proprietaire_id(nom, prenom), bien:bien_id!inner(agence)')
    .eq('mois_facturation', mois)
    .eq('bien.agence', AGENCE)
    .order('created_at', { ascending: true })
  if (bienIds) fraisQuery = fraisQuery.in('bien_id', bienIds)
  const [{ data: prestations, error: prestErr }, { data: frais, error: fraisErr }] = await Promise.all([
    prestQuery,
    fraisQuery,
  ])
  if (prestErr) throw new Error(`Débours/prestations — prestations : ${prestErr.message}`)
  if (fraisErr) throw new Error(`Débours/prestations — frais : ${fraisErr.message}`)
  return { prestations: prestations || [], frais: frais || [] }
}

export async function exportDeboursPrestations(mois, bienIds = null) {
  const { prestations, frais } = await fetchData(mois, bienIds)

  const STATUT_PREST = { 'valide': 'Validée', 'en_attente': 'En attente', 'refuse': 'Refusée', 'annule': 'Annulée' }
  const IMPUTATION   = { 'haowner': 'Achat DCB pour proprio', 'debours_proprio': 'Débours propriétaire', 'deduction_loy': 'Déduction loyer AE' }
  const MODE_TRAIT   = { 'deduction_honoraires': 'Déduction honoraires', 'remboursement': 'Remboursement', 'inclus_debours': 'Inclus débours' }
  const MODE_ENCAISS = { 'virement': 'Virement', 'stripe': 'Stripe', 'especes': 'Espèces', 'cheque': 'Chèque' }
  const STATUT_FRAIS = { 'a_facturer': 'À facturer', 'facture': 'Facturé', 'annule': 'Annulé' }
  const STATUT_DED   = { 'a_deduire': 'À déduire', 'deduit': 'Déduit', 'non_applicable': 'Non applicable' }

  // Onglet 1 — Prestations hors forfait
  const prestRows = prestations.map(p => ({
    'Bien': p.bien?.hospitable_name || '',
    'Type de prestation': p.prestation_type?.nom || '',
    'Description': p.description || '',
    'Date': p.date_prestation || '',
    'Montant EUR': p.montant ? (p.montant / 100).toFixed(2) : '',
    'Auto-entrepreneur': p.auto_entrepreneur ? `${p.auto_entrepreneur.prenom} ${p.auto_entrepreneur.nom}`.trim() : '',
    'Statut': STATUT_PREST[p.statut] || p.statut || '',
    "Type d'imputation": IMPUTATION[p.type_imputation] || p.type_imputation || '',
  }))

  // Onglet 2 — Frais propriétaire
  const fraisRows = frais.map(f => ({
    'Propriétaire': f.proprietaire ? `${f.proprietaire.prenom || ''} ${f.proprietaire.nom}`.trim() : '',
    'Libellé': f.libelle || '',
    'Montant TTC EUR': f.montant_ttc ? (f.montant_ttc / 100).toFixed(2) : '',
    'Mode de traitement': MODE_TRAIT[f.mode_traitement] || f.mode_traitement || '',
    "Mode d'encaissement": MODE_ENCAISS[f.mode_encaissement] || f.mode_encaissement || '',
    'Statut': STATUT_FRAIS[f.statut] || f.statut || '',
    'Statut déduction': STATUT_DED[f.statut_deduction] || f.statut_deduction || '',
    'Date de création': f.created_at?.slice(0, 10) || ''
  }))

  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.json_to_sheet(prestRows.length > 0 ? prestRows : [{}])
  const ws2 = XLSX.utils.json_to_sheet(fraisRows.length > 0 ? fraisRows : [{}])

  XLSX.utils.book_append_sheet(wb, ws1, 'Prestations hors forfait')
  XLSX.utils.book_append_sheet(wb, ws2, 'Frais propriétaire')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Aperçu consulter — CSV combiné (2 sections)
export async function exportDeboursPrestationsCombined(mois, bienIds = null) {
  const { prestations, frais } = await fetchData(mois, bienIds)

  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const row = cols => cols.map(q).join(';')

  const lines = ['\uFEFF']

  // Section 1 — Prestations
  lines.push(row(['PRESTATIONS HORS FORFAIT', '', '', '', '', '', '', '']))
  lines.push(row(['Bien', 'Type de prestation', 'Description', 'Date', 'Montant EUR', 'Auto-entrepreneur', 'Statut', "Type d'imputation"]))
  for (const p of prestations) {
    lines.push(row([
      p.bien?.hospitable_name || '',
      p.prestation_type?.nom || '',
      p.description || '',
      p.date_prestation || '',
      p.montant ? (p.montant / 100).toFixed(2) : '',
      p.auto_entrepreneur ? `${p.auto_entrepreneur.prenom} ${p.auto_entrepreneur.nom}`.trim() : '',
      p.statut || '',
      p.type_imputation || '',
    ]))
  }

  lines.push(row([]))
  lines.push(row([]))

  // Section 2 — Frais propriétaire
  lines.push(row(['FRAIS PROPRIETAIRE', '', '', '', '', '', '', '']))
  lines.push(row(['Propriétaire', 'Libellé', 'Montant TTC EUR', 'Mode de traitement', "Mode d'encaissement", 'Statut', 'Statut déduction', 'Date de création']))
  for (const f of frais) {
    lines.push(row([
      f.proprietaire ? `${f.proprietaire.prenom || ''} ${f.proprietaire.nom}`.trim() : '',
      f.libelle || '',
      f.montant_ttc ? (f.montant_ttc / 100).toFixed(2) : '',
      f.mode_traitement || '',
      f.mode_encaissement || '',
      f.statut || '',
      f.statut_deduction || '',
      f.created_at?.slice(0, 10) || '',
    ]))
  }

  return lines.join('\n')
}
