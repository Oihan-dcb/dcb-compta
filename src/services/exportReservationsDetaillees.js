import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export async function exportReservationsDetaillees(mois) {
  const [{ data: resas }, { data: ventils }] = await Promise.all([
    supabase.from('reservation')
      .select('*, bien:bien_id(code, hospitable_name, proprietaire:proprietaire_id(nom, prenom))')
      .eq('mois_comptable', mois)
      .order('arrival_date', { ascending: true }),
    supabase.from('ventilation')
      .select('reservation_id, code, montant_ht, montant_tva, montant_ttc, montant_reel')
      .eq('mois_comptable', mois)
      .in('code', ['HON', 'FMEN', 'AUTO', 'LOY', 'VIR', 'TAXE', 'COM'])
  ])

  const ventByResa = {}
  for (const v of (ventils || [])) {
    if (!ventByResa[v.reservation_id]) ventByResa[v.reservation_id] = {}
    ventByResa[v.reservation_id][v.code] = v
  }

  const now = new Date()
  const dateExport = format(now, 'dd/MM/yyyy à HH:mm', { locale: fr })
  const moisLabel = format(new Date(mois + '-01'), 'MMMM yyyy', { locale: fr })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const header = [
    '"═══════════════════════════════════════════════════════════════"',
    '"  DESTINATION COTE BASQUE"',
    `"  Export Reservations Detaillees · ${moisLabelCap}"`,
    `"  Genere le ${dateExport}"`,
    '"═══════════════════════════════════════════════════════════════"',
    '""',
  ].join('\n')

  const colonnes = [
    'Code résa', 'Bien', 'Propriétaire', 'Plateforme', 'Voyageur',
    'Arrivée', 'Départ', 'Nuits', 'Revenu net EUR',
    'Ventilation calculée', 'Rapprochée', 'Séjour propriétaire', 'Statut',
    'HON EUR', 'FMEN EUR', 'AUTO EUR', 'LOY EUR', 'VIR EUR', 'TAXE EUR', 'COM EUR'
  ]

  const lignes = (resas || []).map(r => {
    const bien = r.bien || {}
    const proprio = bien.proprietaire || {}
    const proprioNom = `${proprio.prenom || ''} ${proprio.nom || ''}`.trim()
    const vent = ventByResa[r.id] || {}

    return [
      r.code || '',
      bien.hospitable_name || '',
      proprioNom,
      r.platform || '',
      r.guest_name || '',
      r.arrival_date ? format(new Date(r.arrival_date), 'dd/MM/yyyy', { locale: fr }) : '',
      r.departure_date ? format(new Date(r.departure_date), 'dd/MM/yyyy', { locale: fr }) : '',
      r.nights || '',
      r.fin_revenue ? (r.fin_revenue / 100).toFixed(2) : '',
      r.ventilation_calculee ? 'Oui' : 'Non',
      r.rapprochee ? 'Oui' : 'Non',
      r.owner_stay ? 'Oui' : 'Non',
      r.final_status || '',
      vent.HON  ? (vent.HON.montant_ttc  / 100).toFixed(2) : '',
      vent.FMEN ? (vent.FMEN.montant_ttc / 100).toFixed(2) : '',
      vent.AUTO ? ((vent.AUTO.montant_reel ?? vent.AUTO.montant_ht) / 100).toFixed(2) : '',
      vent.LOY  ? (vent.LOY.montant_ht   / 100).toFixed(2) : '',
      vent.VIR  ? (vent.VIR.montant_ht   / 100).toFixed(2) : '',
      vent.TAXE ? (vent.TAXE.montant_ht  / 100).toFixed(2) : '',
      vent.COM  ? (vent.COM.montant_ttc  / 100).toFixed(2) : ''
    ]
  })

  const nbTotal = lignes.length
  const nbVentilees = (resas || []).filter(r => r.ventilation_calculee).length
  const nbRapprochees = (resas || []).filter(r => r.rapprochee).length
  const nbOwnerStay = (resas || []).filter(r => r.owner_stay).length
  const nbCancelled = (resas || []).filter(r => r.final_status === 'cancelled').length
  const totalRevenue = (resas || []).reduce((s, r) => s + (r.fin_revenue || 0), 0)

  const footer = [
    '""',
    '"─────────────────────────────────────────────────────────────"',
    '"TOTAUX & CONTROLES"',
    '"─────────────────────────────────────────────────────────────"',
    `"Total reservations";"${nbTotal}"`,
    `"Ventilees";"${nbVentilees}"`,
    `"Rapprochees";"${nbRapprochees}"`,
    `"Owner stay";"${nbOwnerStay}"`,
    `"Annulees";"${nbCancelled}"`,
    '""',
    `"Total fin_revenue";"${(totalRevenue / 100).toFixed(2)} EUR"`,
    `"Non ventilees";"${nbTotal - nbVentilees}"`,
    `"Non rapprochees";"${nbTotal - nbRapprochees}"`,
    '"═══════════════════════════════════════════════════════════════"'
  ].join('\n')

  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lignesCSV = lignes.map(row => row.map(q).join(';')).join('\n')
  const colonnesCSV = colonnes.map(q).join(';')

  return '\uFEFF' + header + '\n' + colonnesCSV + '\n' + lignesCSV + '\n' + footer
}
