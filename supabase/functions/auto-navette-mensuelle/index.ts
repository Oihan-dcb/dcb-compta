/**
 * auto-navette-mensuelle
 * Appelée par pg_cron le dernier jour de chaque mois.
 * Génère et envoie la fiche navette pour chaque staff avec auto_send_navette = true.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getDaysOfMonth(mois: string): string[] {
  const [y, m] = mois.split('-').map(Number)
  const days: string[] = []
  const d = new Date(y, m - 1, 1)
  while (d.getMonth() === m - 1) {
    days.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function netHeures(row: any): number | null {
  if (!row?.heure_debut || !row?.heure_fin) return null
  const [h1, m1] = row.heure_debut.split(':').map(Number)
  const [h2, m2] = row.heure_fin.split(':').map(Number)
  const min = (h2 * 60 + m2) - (h1 * 60 + m1) - (row.pause_min || 0)
  return min > 0 ? +((min / 60).toFixed(2)) : 0
}

function genererHtml(ae: any, mois: string, heuresMap: Record<string, any>): string {
  const days = getDaysOfMonth(mois)
  const moisLabel = new Date(mois + '-02').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

  const ABSENCES_LABEL: Record<string, string> = {
    conge_paye: 'Congés payés', maladie: 'Maladie',
    rtt: 'RTT', ferie: 'Férié', repos: 'Absences non rémunérées',
  }
  const ABSENCES_COURT: Record<string, string> = {
    conge_paye: 'CP', maladie: 'Maladie', rtt: 'RTT', ferie: 'Férié', repos: 'Repos',
  }
  const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
  const fmt2 = (d: string) => d ? d.split('-').reverse().join('/') : ''

  const semH = [0, 0, 0, 0]
  let totalH = 0
  for (const d of days) {
    const jour = parseInt(d.split('-')[2])
    const si = jour <= 7 ? 0 : jour <= 14 ? 1 : jour <= 21 ? 2 : 3
    const h = netHeures(heuresMap[d])
    if (h) { semH[si] += h; totalH += h }
  }
  const sup = semH.map(h => Math.max(0, h - 35))

  const absences: { motif: string; debut: string; fin: string }[] = []
  let cur: { motif: string; debut: string; fin: string } | null = null
  for (const d of days) {
    const abs = heuresMap[d]?.type_absence || null
    if (abs) {
      if (cur && cur.motif === abs) { cur.fin = d }
      else { cur = { motif: abs, debut: d, fin: d }; absences.push(cur) }
    } else { cur = null }
  }

  const td  = 'padding:6px 8px;border:1px solid #999;font-size:12px;'
  const th  = 'padding:6px 8px;border:1px solid #999;font-size:11px;background:#f3f4f6;font-weight:600;text-align:center;'

  const nbLignes = Math.max(1, absences.length)
  let lignesEmploye = ''
  for (let i = 0; i < nbLignes; i++) {
    const abs = absences[i]
    if (i === 0) {
      lignesEmploye += `<tr>
        <td style="${td}">${ae.matricule || ''}</td>
        <td style="${td};font-weight:600">${ae.nom.toUpperCase()}</td>
        <td style="${td}">${ae.prenom}</td>
        <td style="${td};text-align:center">35</td>
        <td style="${td};text-align:center">${sup[0] > 0 ? sup[0].toFixed(2) : ''}</td>
        <td style="${td};text-align:center">${sup[1] > 0 ? sup[1].toFixed(2) : ''}</td>
        <td style="${td};text-align:center">${sup[2] > 0 ? sup[2].toFixed(2) : ''}</td>
        <td style="${td};text-align:center">${sup[3] > 0 ? sup[3].toFixed(2) : ''}</td>
        <td style="${td}"></td><td style="${td}"></td>
        <td style="${td}"></td><td style="${td}"></td>
        <td style="${td}">${abs ? ABSENCES_LABEL[abs.motif] || abs.motif : ''}</td>
        <td style="${td};text-align:center">${abs ? fmt2(abs.debut) : ''}</td>
        <td style="${td};text-align:center">${abs ? fmt2(abs.fin) : ''}</td>
        <td style="${td}"></td>
      </tr>`
    } else {
      lignesEmploye += `<tr>
        <td style="${td}" colspan="12"></td>
        <td style="${td}">${abs ? ABSENCES_LABEL[abs.motif] || abs.motif : ''}</td>
        <td style="${td};text-align:center">${abs ? fmt2(abs.debut) : ''}</td>
        <td style="${td};text-align:center">${abs ? fmt2(abs.fin) : ''}</td>
        <td style="${td}"></td>
      </tr>`
    }
  }

  let lignes = ''
  for (const d of days) {
    const row = heuresMap[d]
    const date = new Date(d + 'T12:00:00')
    const isWE = date.getDay() === 0 || date.getDay() === 6
    const h = netHeures(row)
    const absence = row?.type_absence ? (ABSENCES_COURT[row.type_absence] || row.type_absence) : ''
    lignes += `<tr style="background:${isWE ? '#f9fafb' : '#fff'}">
      <td style="padding:4px 8px;border:1px solid #e5e7eb;color:${isWE ? '#9ca3af' : '#374151'}">${JOURS[date.getDay()]} ${date.getDate()}</td>
      <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${row?.heure_debut || ''}</td>
      <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${row?.heure_fin || ''}</td>
      <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${row?.pause_min ? row.pause_min + ' min' : ''}</td>
      <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center;font-weight:600;color:${h ? '#15803d' : '#6b7280'}">${h !== null ? h.toFixed(2) + 'h' : absence}</td>
      <td style="padding:4px 8px;border:1px solid #e5e7eb;font-size:11px;color:#6b7280">${row?.notes || ''}</td>
    </tr>`
  }

  return `<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;font-size:13px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
      <tr>
        <td style="font-size:20px;font-weight:700;padding:6px 0">FICHE NAVETTE</td>
        <td style="text-align:right;font-size:13px;font-weight:600">MOIS DE PAIE : ${moisLabelCap.toUpperCase()}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #999">
      <tr>
        <td style="${td};font-weight:600">NOM ENTREPRISE</td>
        <td style="${td}">SARL DESTINATION COTE BASQUE</td>
        <td style="${td};font-weight:600;text-align:right">COMPACT</td>
      </tr>
      <tr><td style="${td}">Téléphone : 05 59 55 41 46</td><td colspan="2" style="${td}"></td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;border:1px solid #999">
      <thead>
        <tr style="background:#e8e8e8">
          <th colspan="3" style="${th}">SALARIÉ</th>
          <th colspan="1" style="${th}">Heures<br>Normales</th>
          <th colspan="4" style="${th}">Heures sup</th>
          <th colspan="2" style="${th}">Primes brutes</th>
          <th style="${th}">Acompte</th>
          <th style="${th}">repas</th>
          <th colspan="3" style="${th}">ABSENCES</th>
          <th style="${th}">Observations</th>
        </tr>
        <tr style="background:#f3f4f6">
          <th style="${th}">Matricule</th><th style="${th}">Nom</th><th style="${th}">Prénom</th>
          <th style="${th}">Heures contrat</th>
          <th style="${th}">S1</th><th style="${th}">S2</th><th style="${th}">S3</th><th style="${th}">S4</th>
          <th style="${th}">Montant</th><th style="${th}">Dénomination</th>
          <th style="${th}">Acompte</th><th style="${th}">repas</th>
          <th style="${th}">Motif absences</th><th style="${th}">Date départ</th><th style="${th}">Date fin</th>
          <th style="${th}">Saisie arrêt, remboursements frais, déplacements, formation…</th>
        </tr>
      </thead>
      <tbody>${lignesEmploye}</tbody>
    </table>
    <p style="font-size:11px;color:#6b7280;margin-top:8px">
      congés payés &nbsp;|&nbsp; maladie &nbsp;|&nbsp; absences non rémunérées &nbsp;|&nbsp; accident de travail &nbsp;|&nbsp; évènement familial
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
    <p style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px">Détail journalier (annexe)</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f3f4f6">
        <th style="${th};text-align:left">Jour</th>
        <th style="${th}">Début</th><th style="${th}">Fin</th><th style="${th}">Pause</th>
        <th style="${th}">Heures</th><th style="${th};text-align:left">Notes</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
      <tfoot><tr style="background:#f0fdf4;font-weight:700">
        <td colspan="4" style="${td}">Total ${moisLabelCap}</td>
        <td style="${td};text-align:center;color:#15803d">${totalH.toFixed(2)}h</td>
        <td style="${td}"></td>
      </tr></tfoot>
    </table>
    <p style="color:#9ca3af;font-size:10px;margin-top:12px">Généré automatiquement depuis DCB Compta</p>
  </div>`
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  // Mois courant (ou mois passé en body pour test)
  const body = await req.json().catch(() => ({}))
  const now  = new Date()
  const mois = body.mois || now.toISOString().slice(0, 7)

  // Staff avec auto_send_navette activé
  const { data: staffList, error: staffErr } = await sb
    .from('auto_entrepreneur')
    .select('id, nom, prenom, matricule, agence')
    .in('type', ['staff', 'assistante'])
    .eq('auto_send_navette', true)
    .eq('actif', true)

  if (staffErr) return json({ error: staffErr.message }, 500)
  if (!staffList?.length) return json({ ok: true, sent: 0, message: 'Aucun staff avec auto_send_navette actif' })

  const results: any[] = []

  for (const ae of staffList) {
    // Charger les heures du mois
    const { data: heuresRows } = await sb
      .from('staff_heures_jour')
      .select('*')
      .eq('ae_id', ae.id)
      .eq('mois', mois)

    const heuresMap: Record<string, any> = {}
    for (const row of heuresRows || []) heuresMap[row.date] = row

    // Générer HTML navette
    const html = genererHtml(ae, mois, heuresMap)
    const moisLabel = new Date(mois + '-02').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const moisLabelCap = moisLabel.charAt(0).toUpperCase() + moisLabel.slice(1)

    // Envoyer via smtp-send
    const { data: r, error: e } = await sb.functions.invoke('smtp-send', {
      body: {
        to: 'anne@compact.fr',
        subject: `Navette paie ${ae.prenom} ${ae.nom} — ${moisLabelCap}`,
        html,
      },
    })

    results.push({
      ae: `${ae.prenom} ${ae.nom}`,
      ok: !e && r?.ok,
      error: e?.message || r?.error || null,
    })
  }

  console.log('auto-navette-mensuelle:', mois, results)
  return json({ ok: true, mois, sent: results.filter(r => r.ok).length, results })
})
