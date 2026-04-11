import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export async function exportAutoDebours(mois) {
  const [
    { data: ventilAuto },
    { data: missions },
    { data: prestations },
    { data: frais },
    { data: resas }
  ] = await Promise.all([
    supabase.from('ventilation')
      .select('reservation_id, montant_ht, montant_reel')
      .eq('mois_comptable', mois)
      .eq('code', 'AUTO'),
    supabase.from('mission_menage')
      .select('reservation_id, ae_id, date_mission, duree_heures, montant, auto_entrepreneur:ae_id(prenom, nom)')
      .eq('mois', mois),
    supabase.from('prestation_hors_forfait')
      .select('reservation_id, bien_id, montant_ht, type_imputation, prestation_type:prestation_type_id(nom), auto_entrepreneur:ae_id(prenom, nom)')
      .eq('mois', mois)
      .not('ae_id', 'is', null),
    supabase.from('frais_proprietaire')
      .select('bien_id, libelle, montant_ttc, mode_traitement, mode_encaissement, statut')
      .eq('mois_facturation', mois)
      .in('statut', ['a_facturer', 'facture']),
    supabase.from('reservation')
      .select('id, code, arrival_date, departure_date, bien:bien_id(id, code, hospitable_name)')
      .eq('mois_comptable', mois)
  ])

  const ventilByResa = {}
  for (const v of (ventilAuto || [])) ventilByResa[v.reservation_id] = v

  const missionsByResa = {}
  for (const m of (missions || [])) {
    if (!missionsByResa[m.reservation_id]) missionsByResa[m.reservation_id] = []
    missionsByResa[m.reservation_id].push(m)
  }

  const prestByResa = {}
  for (const p of (prestations || [])) {
    if (!prestByResa[p.reservation_id]) prestByResa[p.reservation_id] = []
    prestByResa[p.reservation_id].push(p)
  }

  const fraisByBien = {}
  for (const f of (frais || [])) {
    if (!fraisByBien[f.bien_id]) fraisByBien[f.bien_id] = []
    fraisByBien[f.bien_id].push(f)
  }

  const now = new Date()
  const dateExport = format(now, 'dd/MM/yyyy à HH:mm', { locale: fr })
  const moisLabel = format(new Date(mois + '-01'), 'MMMM yyyy', { locale: fr })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const header = [
    '"═══════════════════════════════════════════════════════════════"',
    '"  DESTINATION COTE BASQUE"',
    `"  Export AUTO & Debours · ${moisLabelCap}"`,
    `"  Genere le ${dateExport}"`,
    '"═══════════════════════════════════════════════════════════════"',
    '""',
  ].join('\n')

  const colonnes = [
    'Code resa', 'Bien', 'Check-in', 'Check-out',
    'AUTO Provision EUR', 'AUTO Reel EUR', 'Ecart EUR', 'Ecart %',
    'AE', 'Mission date', 'Mission duree (h)',
    'Prestations extras', 'HAOWNER EUR', 'DEBP EUR', 'DEB_AE EUR',
    'Frais proprio'
  ]

  const lignes = (resas || []).map(r => {
    const ventil = ventilByResa[r.id] || {}
    const provision = ventil.montant_ht || 0
    const reel = ventil.montant_reel ?? provision
    const ecart = reel - provision
    const ecartPct = provision > 0 ? ((ecart / provision) * 100).toFixed(1) + '%' : ''

    const missionsResa = missionsByResa[r.id] || []
    const aeNoms = [...new Set(missionsResa.map(m =>
      m.auto_entrepreneur ? `${m.auto_entrepreneur.prenom} ${m.auto_entrepreneur.nom}`.trim() : ''
    ))].filter(Boolean).join(' | ')
    const missionDates = missionsResa.map(m => m.date_mission).filter(Boolean).join(' | ')
    const missionDurees = missionsResa.map(m => m.duree_heures).filter(Boolean).join(' | ')

    const prestsResa = prestByResa[r.id] || []
    const prestStr = prestsResa.map(p =>
      `${p.prestation_type?.nom || '?'}: ${((p.montant_ht || 0) / 100).toFixed(2)}€`
    ).join(' | ')
    const haowner = prestsResa.filter(p => p.type_imputation === 'haowner').reduce((s, p) => s + (p.montant_ht || 0), 0)
    const debp    = prestsResa.filter(p => p.type_imputation === 'debours_proprio').reduce((s, p) => s + (p.montant_ht || 0), 0)
    const debae   = prestsResa.filter(p => p.type_imputation === 'deduction_loy').reduce((s, p) => s + (p.montant_ht || 0), 0)

    const fraisBien = fraisByBien[r.bien?.id] || []
    const fraisStr = fraisBien.map(f =>
      `${f.libelle} (${f.mode_traitement}): ${((f.montant_ttc || 0) / 100).toFixed(2)}€`
    ).join(' | ')

    return [
      r.code || '',
      r.bien?.hospitable_name || '',
      r.arrival_date ? format(new Date(r.arrival_date), 'dd/MM/yyyy', { locale: fr }) : '',
      r.departure_date ? format(new Date(r.departure_date), 'dd/MM/yyyy', { locale: fr }) : '',
      (provision / 100).toFixed(2),
      (reel / 100).toFixed(2),
      (ecart / 100).toFixed(2),
      ecartPct,
      aeNoms,
      missionDates,
      missionDurees,
      prestStr,
      (haowner / 100).toFixed(2),
      (debp / 100).toFixed(2),
      (debae / 100).toFixed(2),
      fraisStr
    ]
  })

  const totalProvision = Object.values(ventilByResa).reduce((s, v) => s + (v.montant_ht || 0), 0)
  const totalReel = Object.values(ventilByResa).reduce((s, v) => s + (v.montant_reel ?? (v.montant_ht || 0)), 0)
  const totalEcart = totalReel - totalProvision
  const nbEcartsSignificatifs = lignes.filter(l => Math.abs(parseFloat(l[6])) > 20).length

  const footer = [
    '""',
    '"─────────────────────────────────────────────────────────────"',
    '"TOTAUX & CONTROLES"',
    '"─────────────────────────────────────────────────────────────"',
    `"Total AUTO provision";"${(totalProvision / 100).toFixed(2)} EUR"`,
    `"Total AUTO reel";"${(totalReel / 100).toFixed(2)} EUR"`,
    `"Ecart total";"${(totalEcart / 100).toFixed(2)} EUR"`,
    '""',
    `"Reservations avec AUTO";"${lignes.length}"`,
    `"Ecarts > 20 EUR";"${nbEcartsSignificatifs}"`,
    '"═══════════════════════════════════════════════════════════════"'
  ].join('\n')

  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lignesCSV = lignes.map(row => row.map(q).join(';')).join('\n')
  const colonnesCSV = colonnes.map(q).join(';')

  return '\uFEFF' + header + '\n' + colonnesCSV + '\n' + lignesCSV + '\n' + footer
}
