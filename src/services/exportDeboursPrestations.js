import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

export async function exportDeboursPrestations(mois) {
  const [{ data: prestations }, { data: frais }] = await Promise.all([
    supabase.from('prestation_hors_forfait')
      .select('*, bien:bien_id(code, hospitable_name), prestation_type:prestation_type_id(nom), auto_entrepreneur:ae_id(prenom, nom)')
      .eq('mois', mois)
      .order('date_prestation', { ascending: true }),
    supabase.from('frais_proprietaire')
      .select('*, proprietaire:proprietaire_id(nom, prenom)')
      .eq('mois_facturation', mois)
      .order('date_creation', { ascending: true })
  ])

  // Onglet 1 — Prestations hors forfait
  const prestRows = (prestations || []).map(p => ({
    'Bien': p.bien?.hospitable_name || '',
    'Type prestation': p.prestation_type?.nom || '',
    'Description': p.description || '',
    'Date': p.date_prestation || '',
    'Montant HT EUR': p.montant_ht ? (p.montant_ht / 100).toFixed(2) : '',
    'AE': p.auto_entrepreneur ? `${p.auto_entrepreneur.prenom} ${p.auto_entrepreneur.nom}`.trim() : '',
    'Statut': p.statut || '',
    'Type imputation': p.type_imputation || '',
  }))

  // Onglet 2 — Frais propriétaire
  const fraisRows = (frais || []).map(f => ({
    'Proprietaire': f.proprietaire ? `${f.proprietaire.prenom || ''} ${f.proprietaire.nom}`.trim() : '',
    'Libelle': f.libelle || '',
    'Montant HT EUR': f.montant_ht ? (f.montant_ht / 100).toFixed(2) : '',
    'Montant TTC EUR': f.montant_ttc ? (f.montant_ttc / 100).toFixed(2) : '',
    'Mode traitement': f.mode_traitement || '',
    'Mode encaissement': f.mode_encaissement || '',
    'Statut': f.statut || '',
    'Statut deduction': f.statut_deduction || '',
    'Date creation': f.date_creation || ''
  }))

  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.json_to_sheet(prestRows.length > 0 ? prestRows : [{}])
  const ws2 = XLSX.utils.json_to_sheet(fraisRows.length > 0 ? fraisRows : [{}])

  XLSX.utils.book_append_sheet(wb, ws1, 'Prestations hors forfait')
  XLSX.utils.book_append_sheet(wb, ws2, 'Frais proprietaire')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
