import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export async function exportFacturesEvoliz(mois) {
  const { data: factures } = await supabase
    .from('facture_evoliz')
    .select(`*, proprietaire:proprietaire_id(nom, prenom),
      lignes:facture_evoliz_ligne(code, montant_ht, montant_ttc, quantite, libelle, bien:bien_id(hospitable_name))`)
    .eq('mois', mois)
    .order('date_creation', { ascending: true })

  const now = new Date()
  const dateExport = format(now, 'dd/MM/yyyy à HH:mm', { locale: fr })
  const moisLabel = format(new Date(mois + '-01'), 'MMMM yyyy', { locale: fr })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const header = [
    '"═══════════════════════════════════════════════════════════════"',
    '"  DESTINATION COTE BASQUE"',
    `"  Export Factures Evoliz · ${moisLabelCap}"`,
    `"  Genere le ${dateExport}"`,
    '"═══════════════════════════════════════════════════════════════"',
    '""',
  ].join('\n')

  const colonnes = [
    'Proprietaire', 'Bien', 'Type facture', 'Numero facture', 'Statut',
    'Date generation', 'Date push Evoliz', 'ID Evoliz',
    'Total HT EUR', 'Total TTC EUR', 'Montant reversement EUR',
    'Lignes detaillees'
  ]

  const typeLabels = { 'honoraires': 'Honoraires', 'debours': 'Debours', 'com': 'Commission' }
  const statutLabels = {
    'brouillon': 'Brouillon', 'calcul_en_cours': 'Calcul en cours',
    'valide': 'Validee', 'envoi_en_cours': 'Envoi en cours',
    'envoye_evoliz': 'Envoyee Evoliz', 'payee': 'Payee'
  }

  const lignes = (factures || []).map(f => {
    const proprio = f.proprietaire
    const proprioNom = proprio ? `${proprio.prenom || ''} ${proprio.nom}`.trim() : ''
    const lignesDetail = (f.lignes || []).map(l =>
      `${l.code}: ${((l.montant_ttc || 0) / 100).toFixed(2)}€`
    ).join(' | ')

    return [
      proprioNom,
      [...new Set((f.lignes || []).map(l => l.bien?.hospitable_name).filter(Boolean))].join(', ') || '',
      typeLabels[f.type_facture] || f.type_facture,
      f.numero_facture || '',
      statutLabels[f.statut] || f.statut || '',
      f.created_at ? format(new Date(f.created_at), 'dd/MM/yyyy', { locale: fr }) : '',
      f.date_emission ? format(new Date(f.date_emission), 'dd/MM/yyyy', { locale: fr }) : '',
      f.id_evoliz || '',
      ((f.total_ht || 0) / 100).toFixed(2),
      ((f.total_ttc || 0) / 100).toFixed(2),
      f.montant_reversement ? (f.montant_reversement / 100).toFixed(2) : '',
      lignesDetail
    ]
  })

  const totalHT = (factures || []).reduce((s, f) => s + (f.total_ht || 0), 0)
  const totalTTC = (factures || []).reduce((s, f) => s + (f.total_ttc || 0), 0)
  const totalReversement = (factures || []).filter(f => f.montant_reversement).reduce((s, f) => s + (f.montant_reversement || 0), 0)
  const nbHonoraires = (factures || []).filter(f => f.type_facture === 'honoraires').length
  const nbDebours = (factures || []).filter(f => f.type_facture === 'debours').length
  const nbBrouillon = (factures || []).filter(f => f.statut === 'brouillon').length
  const nbEnvoyees = (factures || []).filter(f => f.statut === 'envoye_evoliz').length

  const footer = [
    '""',
    '"─────────────────────────────────────────────────────────────"',
    '"TOTAUX & CONTROLES"',
    '"─────────────────────────────────────────────────────────────"',
    `"Total HT";"${(totalHT / 100).toFixed(2)} EUR"`,
    `"Total TTC";"${(totalTTC / 100).toFixed(2)} EUR"`,
    `"Total reversements";"${(totalReversement / 100).toFixed(2)} EUR"`,
    '""',
    `"Factures honoraires";"${nbHonoraires}"`,
    `"Factures debours";"${nbDebours}"`,
    `"Envoyees Evoliz";"${nbEnvoyees}"`,
    `"Brouillons restants";"${nbBrouillon}"`,
    '"═══════════════════════════════════════════════════════════════"'
  ].join('\n')

  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lignesCSV = lignes.map(row => row.map(q).join(';')).join('\n')
  const colonnesCSV = colonnes.map(q).join(';')

  return '\uFEFF' + header + '\n' + colonnesCSV + '\n' + lignesCSV + '\n' + footer
}
