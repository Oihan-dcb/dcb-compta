import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import ExcelJS from 'exceljs'

const BRAND  = 'CC9933'
const BEIGE  = 'EAE3D4'
const CREAM  = 'FAF8F4'
const WHITE  = 'FFFFFF'
const BROWN  = '2C2416'
const GREY   = '9C8E7D'

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

function cell(value, opts = {}) {
  return { value, ...opts }
}

function styleRow(row, fill, bold = false, fontSize = 10, fontColor = BROWN) {
  row.eachCell({ includeEmpty: true }, c => {
    if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + fill } }
    c.font = { bold, size: fontSize, color: { argb: 'FF' + fontColor }, name: 'Calibri' }
    c.alignment = { vertical: 'middle', wrapText: true }
  })
}

function addSheet(wb, ae, missions, prestByMission, nomMois) {
  const nomAE = ae ? `${ae.prenom || ''} ${ae.nom || ''}`.trim() : 'AE inconnu'
  const isStaff = ae?.type === 'staff_dcb'
  const tauxHoraire = ae?.taux_horaire ? (ae.taux_horaire / 100).toFixed(2) : '—'
  const sheetName = nomAE.replace(/[:\\/?*[\]]/g, '').slice(0, 31)

  const ws = wb.addWorksheet(sheetName)
  ws.columns = [
    { key: 'A', width: 14 },
    { key: 'B', width: 30 },
    { key: 'C', width: 42 },
    { key: 'D', width: 12 },
    { key: 'E', width: 14 },
  ]

  // ── En-tête AE ────────────────────────────────────────────────────────────
  const r1 = ws.addRow(['RELEVE DE PRESTATIONS — ' + nomAE, '', nomMois, '', ''])
  ws.mergeCells(`A${r1.number}:B${r1.number}`)
  styleRow(r1, BRAND, true, 13, WHITE)
  r1.height = 24

  if (!isStaff) {
    const r2 = ws.addRow(['Taux horaire', tauxHoraire + ' EUR/h', '', '', ''])
    styleRow(r2, BEIGE, false, 10)
    r2.height = 16
  }

  ws.addRow([]) // espace

  // ── Header colonnes ───────────────────────────────────────────────────────
  const headers = ['Date', 'Bien', 'Mission', 'Durée (h)', isStaff ? '' : 'Montant EUR']
  const rh = ws.addRow(headers)
  styleRow(rh, BRAND, true, 10, WHITE)
  rh.height = 18

  // ── Missions par bien ─────────────────────────────────────────────────────
  const parBien = {}
  for (const m of missions) {
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

    ws.addRow([]) // espace avant chaque bien

    const rb = ws.addRow([`BIEN : ${bien?.hospitable_name || key}`, '', '', '', ''])
    ws.mergeCells(`A${rb.number}:E${rb.number}`)
    styleRow(rb, BEIGE, true, 11)
    rb.height = 20

    if (propNom) {
      const rp = ws.addRow([`Propriétaire : ${propNom}`, '', '', '', ''])
      ws.mergeCells(`A${rp.number}:E${rp.number}`)
      styleRow(rp, BEIGE, false, 9, GREY)
      rp.height = 14
    }

    let sousHeures = 0
    let sousMontant = 0
    let sousExtras = 0
    let altBg = false

    for (const m of bienMs) {
      const extras = prestByMission[m.id] || []
      const extrasMontant = extras.reduce((s, p) => s + (p.montant || 0), 0)
      const h = m.duree_heures || 0
      const montant = isStaff ? null : (m.montant ? m.montant / 100 : null)
      sousHeures += h
      if (!isStaff && m.montant) sousMontant += m.montant
      sousExtras += extrasMontant

      const bg = altBg ? CREAM : WHITE
      altBg = !altBg

      const rm = ws.addRow([m.date_mission || '', bien?.hospitable_name || key, m.titre_ical || '', h || '', montant])
      styleRow(rm, bg, false)
      if (montant !== null) rm.getCell(5).numFmt = '#,##0.00 "€"'
      if (h) rm.getCell(4).numFmt = '0.00'
      rm.height = 15

      for (const p of extras) {
        const montantExtra = !isStaff && p.montant ? p.montant / 100 : null
        const re = ws.addRow(['', '', '  → ' + (p.prestation_type?.nom || 'Extra'), '', montantExtra])
        styleRow(re, bg, false, 9, GREY)
        if (montantExtra !== null) re.getCell(5).numFmt = '#,##0.00 "€"'
        re.height = 14
      }
    }

    // Sous-total bien
    const rs = ws.addRow([
      `Sous-total ${key}`, '', '',
      sousHeures ? sousHeures : '',
      !isStaff && (sousMontant + sousExtras) ? (sousMontant + sousExtras) / 100 : null
    ])
    styleRow(rs, BEIGE, true)
    if (sousHeures) rs.getCell(4).numFmt = '0.00'
    if (!isStaff && (sousMontant + sousExtras)) rs.getCell(5).numFmt = '#,##0.00 "€"'
    rs.height = 16

    totalHeures += sousHeures
    totalMontant += sousMontant
    totalExtras += sousExtras
  }

  // ── Total général ─────────────────────────────────────────────────────────
  ws.addRow([])
  const rt = ws.addRow([
    'TOTAL GÉNÉRAL', '', '',
    totalHeures || '',
    !isStaff && (totalMontant + totalExtras) ? (totalMontant + totalExtras) / 100 : null
  ])
  ws.mergeCells(`A${rt.number}:C${rt.number}`)
  styleRow(rt, BRAND, true, 11, WHITE)
  if (totalHeures) rt.getCell(4).numFmt = '0.00'
  if (!isStaff && (totalMontant + totalExtras)) rt.getCell(5).numFmt = '#,##0.00 "€"'
  rt.height = 20
}

// Export XLSX — un onglet par AE
export async function exportAutoDebours(mois) {
  const { missionsByAe, prestByMission, nomMois } = await fetchData(mois)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'DCB Compta'
  wb.created = new Date()

  for (const [, { ae, missions }] of Object.entries(missionsByAe)) {
    addSheet(wb, ae, missions, prestByMission, nomMois)
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// Aperçu consulter — CSV combiné avec séparateurs par AE
export async function exportAutoDeboursCombined(mois) {
  const { missionsByAe, prestByMission, nomMois } = await fetchData(mois)

  const sep = c => `"${String(c ?? '').replace(/"/g, '""')}"`
  const row = cols => cols.map(sep).join(';')

  const lines = ['\uFEFF']

  for (const [, { ae, missions }] of Object.entries(missionsByAe)) {
    const nomAE = ae ? `${ae.prenom || ''} ${ae.nom || ''}`.trim() : 'AE inconnu'
    const isStaff = ae?.type === 'staff_dcb'
    const tauxHoraire = ae?.taux_horaire ? (ae.taux_horaire / 100).toFixed(2) : '—'

    lines.push(row(['═══════════════════════════════════════', nomAE, nomMois, '', '']))
    lines.push(row(['RELEVE DE PRESTATIONS', nomAE, nomMois, '', '']))
    if (!isStaff) lines.push(row(['Taux horaire', tauxHoraire + ' EUR/h', '', '', '']))
    lines.push(row([]))
    lines.push(row(['Date', 'Bien', 'Mission', 'Durée (h)', isStaff ? '' : 'Montant EUR']))

    const parBien = {}
    for (const m of missions) {
      const key = m.bien?.code || m.bien?.hospitable_name || 'Inconnu'
      if (!parBien[key]) parBien[key] = { bien: m.bien, missions: [] }
      parBien[key].missions.push(m)
    }

    let totalHeures = 0, totalMontant = 0, totalExtras = 0

    for (const [key, { bien, missions: bienMs }] of Object.entries(parBien)) {
      const proprio = bien?.proprietaire
      const propNom = proprio ? `${proprio.prenom || ''} ${proprio.nom || ''}`.trim() : ''
      lines.push(row([]))
      lines.push(row([`BIEN : ${bien?.hospitable_name || key}`, '', '', '', '']))
      if (propNom) lines.push(row([`Propriétaire : ${propNom}`, '', '', '', '']))

      let sousHeures = 0, sousMontant = 0, sousExtras = 0
      for (const m of bienMs) {
        const extras = prestByMission[m.id] || []
        const h = m.duree_heures || 0
        const montant = isStaff ? '' : (m.montant ? (m.montant / 100).toFixed(2) : '')
        sousHeures += h
        if (!isStaff && m.montant) sousMontant += m.montant
        sousExtras += extras.reduce((s, p) => s + (p.montant || 0), 0)
        lines.push(row([m.date_mission || '', bien?.hospitable_name || key, m.titre_ical || '', h ? h.toString() : '', montant]))
        for (const p of extras) {
          lines.push(row(['', '', '  → ' + (p.prestation_type?.nom || 'Extra'), '', !isStaff && p.montant ? (p.montant / 100).toFixed(2) : '']))
        }
      }
      lines.push(row([`Sous-total ${key}`, '', '', sousHeures ? sousHeures.toFixed(2) + ' h' : '', !isStaff && (sousMontant + sousExtras) ? ((sousMontant + sousExtras) / 100).toFixed(2) + ' EUR' : '']))
      totalHeures += sousHeures; totalMontant += sousMontant; totalExtras += sousExtras
    }

    lines.push(row([]))
    lines.push(row(['TOTAL GÉNÉRAL', '', '', totalHeures ? totalHeures.toFixed(2) + ' h' : '', !isStaff && (totalMontant + totalExtras) ? ((totalMontant + totalExtras) / 100).toFixed(2) + ' EUR' : '']))
    lines.push(row([]))
  }

  return lines.join('\n')
}
