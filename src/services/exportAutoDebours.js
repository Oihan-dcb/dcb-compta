import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import * as XLSX from 'xlsx'

async function fetchData(mois) {
  const [{ data: missions }, { data: prestations }] = await Promise.all([
    supabase.from('mission_menage')
      .select(`
        id, reservation_id, ae_id, date_mission, duree_heures, montant, titre_ical,
        bien:bien_id(code, hospitable_name, proprietaire:proprietaire_id(nom, prenom)),
        auto_entrepreneur:ae_id(id, prenom, nom, taux_horaire, type)
      `)
      .eq('mois', mois)
      .order('date_mission', { ascending: true }),
    supabase.from('prestation_hors_forfait')
      .select(`id, mission_id, ae_id, montant, prestation_type:prestation_type_id(nom)`)
      .eq('mois', mois)
      .not('ae_id', 'is', null),
  ])

  const moisLabel = format(new Date(mois + '-01'), 'MMMM yyyy', { locale: fr })
  const nomMois = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const prestByMission = {}
  for (const p of (prestations || [])) {
    if (!p.mission_id) continue
    if (!prestByMission[p.mission_id]) prestByMission[p.mission_id] = []
    prestByMission[p.mission_id].push(p)
  }

  const missionsByAe = {}
  for (const m of (missions || [])) {
    const aeId = m.ae_id
    if (!missionsByAe[aeId]) missionsByAe[aeId] = { ae: m.auto_entrepreneur, missions: [] }
    missionsByAe[aeId].missions.push(m)
  }

  return { missionsByAe, prestByMission, nomMois }
}

function buildRowsForAe({ ae, missions: ms, prestByMission, nomMois }) {
  const nomAE = ae ? `${ae.prenom || ''} ${ae.nom || ''}`.trim() : 'AE'
  const isStaff = ae?.type === 'staff_dcb'
  const tauxHoraire = ae?.taux_horaire ? (ae.taux_horaire / 100).toFixed(2) : '—'

  const rows = []

  rows.push(['RELEVE DE PRESTATIONS', nomAE, nomMois, '', ''])
  if (!isStaff) rows.push(['Taux horaire', tauxHoraire + ' EUR/h', '', '', ''])
  rows.push([''])

  rows.push(isStaff
    ? ['Date', 'Bien', 'Mission', 'Duree (h)', '']
    : ['Date', 'Bien', 'Mission', 'Duree (h)', 'Montant EUR'])

  const parBien = {}
  for (const m of ms) {
    const key = m.bien?.code || m.bien?.hospitable_name || 'Inconnu'
    if (!parBien[key]) parBien[key] = { bien: m.bien, missions: [] }
    parBien[key].missions.push(m)
  }

  let totalHeures = 0
  let totalMontant = 0
  let totalExtras = 0

  for (const [key, { bien, missions: bienMs }] of Object.entries(parBien)) {
    const proprio = bien?.proprietaire
    const propNom = proprio ? `${proprio.prenom || ''} ${proprio.nom || ''}`.trim() : ''

    rows.push([''])
    rows.push([`BIEN : ${bien?.hospitable_name || key}`, '', '', '', ''])
    if (propNom) rows.push([`Proprietaire : ${propNom}`, '', '', '', ''])

    let sousHeures = 0
    let sousMontant = 0
    let sousExtras = 0

    for (const m of bienMs) {
      const extras = prestByMission[m.id] || []
      const extrasMontant = extras.reduce((s, p) => s + (p.montant || 0), 0)
      const h = m.duree_heures || 0
      const montant = isStaff ? '' : (m.montant ? m.montant / 100 : '')
      sousHeures += h
      if (!isStaff && m.montant) sousMontant += m.montant
      sousExtras += extrasMontant

      rows.push([m.date_mission || '', bien?.hospitable_name || key, m.titre_ical || '', h || '', montant])

      for (const p of extras) {
        rows.push(['', '', '  → ' + (p.prestation_type?.nom || 'Extra'), '', !isStaff && p.montant ? p.montant / 100 : ''])
      }
    }

    rows.push([`Sous-total ${key}`, '', '', sousHeures ? sousHeures : '', !isStaff && (sousMontant + sousExtras) ? (sousMontant + sousExtras) / 100 : ''])
    totalHeures += sousHeures
    totalMontant += sousMontant
    totalExtras += sousExtras
  }

  rows.push([''])
  rows.push(['TOTAL GENERAL', '', '', totalHeures || '', !isStaff && (totalMontant + totalExtras) ? (totalMontant + totalExtras) / 100 : ''])

  return rows
}

// Export XLSX — un onglet par AE
export async function exportAutoDebours(mois) {
  const { missionsByAe, prestByMission, nomMois } = await fetchData(mois)

  const wb = XLSX.utils.book_new()

  for (const [, { ae, missions }] of Object.entries(missionsByAe)) {
    const nomAE = ae ? `${ae.prenom || ''} ${ae.nom || ''}`.trim() : 'AE inconnu'
    const rows = buildRowsForAe({ ae, missions, prestByMission, nomMois })
    const ws = XLSX.utils.aoa_to_sheet(rows)

    // Largeurs colonnes
    ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 40 }, { wch: 12 }, { wch: 14 }]

    // Nom d'onglet : 31 chars max, caractères interdits retirés
    const sheetName = nomAE.replace(/[:\\/?*[\]]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
