import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AGENCE } from '../lib/agence'

export async function exportFacturesEvoliz(mois, bienIds = null) {
  const selectStr = `*, proprietaire:proprietaire_id(nom, prenom),
      lignes:facture_evoliz_ligne(code, montant_ht, montant_ttc, libelle),
      bien:bien_id(hospitable_name)`

  // Requête principale (avec filtre bienIds si actif)
  let query = supabase
    .from('facture_evoliz')
    .select(selectStr)
    .eq('mois', mois)
    .eq('agence', AGENCE)
    .neq('type_facture', 'lauian_fmen')
    .order('created_at', { ascending: true })
  if (bienIds) query = query.in('bien_id', bienIds)
  const { data: facturesDCB, error: fetchError } = await query
  if (fetchError) throw new Error(`Export factures Evoliz : ${fetchError.message}`)

  // Factures FMEN Lauian : jamais filtrées par bienIds (bien_id = bien Lauian, hors sélection DCB)
  const { data: facturesLauian, error: lauianError } = await supabase
    .from('facture_evoliz')
    .select(selectStr)
    .eq('mois', mois)
    .eq('agence', AGENCE)
    .eq('type_facture', 'lauian_fmen')
    .order('created_at', { ascending: true })
  if (lauianError) throw new Error(`Export factures Lauian FMEN : ${lauianError.message}`)

  const factures = [...(facturesDCB || []), ...(facturesLauian || [])]

  const now = new Date()
  const dateExport = format(now, 'dd/MM/yyyy à HH:mm', { locale: fr })
  const moisLabel = format(new Date(mois + '-01'), 'MMMM yyyy', { locale: fr })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const header = [
    '"═══════════════════════════════════════════════════════════════"',
    '"  DESTINATION COTE BASQUE"',
    `"  Export Factures Evoliz · ${moisLabelCap}"`,
    `"  Généré le ${dateExport}"`,
    '"═══════════════════════════════════════════════════════════════"',
    '""',
  ].join('\n')

  const colonnes = [
    'Propriétaire', 'Bien', 'Type facture', 'Numéro facture', 'Statut',
    'Date génération', 'Date envoi Evoliz', 'ID Evoliz',
    'Total HT EUR', 'Total TTC EUR', 'Montant reversement EUR',
    'Lignes détaillées'
  ]

  const typeLabels = { 'honoraires': 'Honoraires', 'debours': 'Débours', 'com': 'Commission', 'lauian_fmen': 'FMEN Lauian' }
  const statutLabels = {
    'brouillon': 'Brouillon', 'calcul_en_cours': 'Calcul en cours',
    'valide': 'Validée', 'envoi_en_cours': 'Envoi en cours',
    'envoye_evoliz': 'Envoyée Evoliz', 'payee': 'Payée'
  }

  const lignes = (factures || []).filter(f => (f.lignes?.length || 0) > 0).map(f => {
    const proprio = f.proprietaire
    const proprioNom = proprio ? `${proprio.prenom || ''} ${proprio.nom}`.trim() : ''
    const lignesDetail = (f.lignes || []).map(l =>
      `${l.code}: ${((l.montant_ttc || 0) / 100).toFixed(2)}€`
    ).join(' | ')

    return [
      proprioNom,
      f.bien?.hospitable_name || '',
      typeLabels[f.type_facture] || f.type_facture,
      f.numero_facture || f.id_evoliz || '',
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
    '"TOTAUX & CONTRÔLES"',
    '"─────────────────────────────────────────────────────────────"',
    `"Total HT";"${(totalHT / 100).toFixed(2)} EUR"`,
    `"Total TTC";"${(totalTTC / 100).toFixed(2)} EUR"`,
    `"Total réversements";"${(totalReversement / 100).toFixed(2)} EUR"`,
    '""',
    `"Factures honoraires";"${nbHonoraires}"`,
    `"Factures débours";"${nbDebours}"`,
    `"Envoyées Evoliz";"${nbEnvoyees}"`,
    `"Brouillons restants";"${nbBrouillon}"`,
    '"═══════════════════════════════════════════════════════════════"'
  ].join('\n')

  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lignesCSV = lignes.map(row => row.map(q).join(';')).join('\n')
  const colonnesCSV = colonnes.map(q).join(';')

  return '\uFEFF' + header + '\n' + colonnesCSV + '\n' + lignesCSV + '\n' + footer
}
