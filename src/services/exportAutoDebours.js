import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export async function exportAutoDebours(mois) {
  const [
    { data: missions },
    { data: prestations },
  ] = await Promise.all([
    supabase.from('mission_menage')
      .select(`
        id, reservation_id, ae_id, date_mission, duree_heures, montant, titre_ical,
        bien:bien_id(code, hospitable_name, proprietaire:proprietaire_id(nom, prenom)),
        auto_entrepreneur:ae_id(id, prenom, nom, taux_horaire, type)
      `)
      .eq('mois', mois)
      .order('date_mission', { ascending: true }),
    supabase.from('prestation_hors_forfait')
      .select(`
        id, mission_id, ae_id, montant,
        prestation_type:prestation_type_id(nom)
      `)
      .eq('mois', mois)
      .not('ae_id', 'is', null),
  ])

  const moisLabel = format(new Date(mois + '-01'), 'MMMM yyyy', { locale: fr })
  const nomMois = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const sep = c => `"${String(c ?? '').replace(/"/g, '""')}"`
  const row = cols => cols.map(sep).join(';')

  // Prestations indexées par mission_id
  const prestByMission = {}
  for (const p of (prestations || [])) {
    if (!p.mission_id) continue
    if (!prestByMission[p.mission_id]) prestByMission[p.mission_id] = []
    prestByMission[p.mission_id].push(p)
  }

  // Missions groupées par AE
  const missionsByAe = {}
  for (const m of (missions || [])) {
    const aeId = m.ae_id
    if (!missionsByAe[aeId]) missionsByAe[aeId] = { ae: m.auto_entrepreneur, missions: [] }
    missionsByAe[aeId].missions.push(m)
  }

  const lines = []

  // ── En-tête document global ───────────────────────────────────────────────
  lines.push(row(['DESTINATION COTE BASQUE', 'Export AUTO & Débours', nomMois, '', '', '']))
  lines.push(row(['', '', '', '', '', '']))

  // ── Une section par AE ────────────────────────────────────────────────────
  for (const [aeId, { ae, missions: ms }] of Object.entries(missionsByAe)) {
    const nomAE = ae ? `${ae.prenom || ''} ${ae.nom || ''}`.trim() : `AE ${aeId}`
    const isStaff = ae?.type === 'staff_dcb'
    const tauxHoraire = ae?.taux_horaire ? (ae.taux_horaire / 100).toFixed(2) : '—'

    lines.push(row(['═══════════════════════════', '', '', '', '', '']))
    lines.push(row(['RELEVE DE PRESTATIONS', nomAE, nomMois, '', '', '']))
    if (!isStaff) lines.push(row(['Taux horaire', tauxHoraire + ' EUR/h', '', '', '', '']))
    lines.push(row(['', '', '', '', '', '']))

    const headers = isStaff
      ? ['Date', 'Bien', 'Mission', 'Duree (h)', '']
      : ['Date', 'Bien', 'Mission', 'Duree (h)', 'Montant EUR']
    lines.push(row(headers))

    // Regrouper par bien
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

      lines.push(row(['', '', '', '', '']))
      lines.push(row([`BIEN : ${bien?.hospitable_name || key}`, '', '', '', '']))
      if (propNom) lines.push(row([`Proprietaire : ${propNom}`, '', '', '', '']))

      let sousHeures = 0
      let sousMontant = 0
      let sousExtras = 0

      for (const m of bienMs) {
        const extras = (prestByMission[m.id] || [])
        const extrasMontant = extras.reduce((s, p) => s + (p.montant || 0), 0)
        const h = m.duree_heures || 0
        const montant = isStaff ? '' : (m.montant ? (m.montant / 100).toFixed(2) : '')
        sousHeures += h
        if (!isStaff && m.montant) sousMontant += m.montant
        sousExtras += extrasMontant

        lines.push(row([
          m.date_mission || '',
          bien?.hospitable_name || key,
          m.titre_ical || '',
          h ? h.toString() : '',
          montant,
        ]))

        for (const p of extras) {
          lines.push(row([
            '',
            '',
            '  → ' + (p.prestation_type?.nom || 'Extra'),
            '',
            !isStaff && p.montant ? (p.montant / 100).toFixed(2) : '',
          ]))
        }
      }

      lines.push(row([
        `Sous-total ${key}`,
        '',
        '',
        sousHeures ? sousHeures.toFixed(2) + ' h' : '',
        !isStaff && (sousMontant + sousExtras) ? ((sousMontant + sousExtras) / 100).toFixed(2) + ' EUR' : '',
      ]))

      totalHeures += sousHeures
      totalMontant += sousMontant
      totalExtras += sousExtras
    }

    lines.push(row(['', '', '', '', '']))
    lines.push(row([
      'TOTAL GENERAL',
      '',
      '',
      totalHeures ? totalHeures.toFixed(2) + ' h' : '',
      !isStaff && (totalMontant + totalExtras) ? ((totalMontant + totalExtras) / 100).toFixed(2) + ' EUR' : '',
    ]))
    lines.push(row(['', '', '', '', '']))
  }

  return '\uFEFF' + lines.join('\n')
}
