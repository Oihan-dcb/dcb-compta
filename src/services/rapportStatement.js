const PLATFORM_COLORS = { airbnb: '#FF5A5F', booking: '#003580', direct: '#2d7a50', stripe: '#2d7a50', default: '#9C8E7D' }
const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

export function genererStatementHTML(proprio, mois, data) {
  const resas = data.resas || []
  const extrasGlobaux = data.extrasGlobaux || []
  const haownerList = data.haownerList || []

  const fmt = (centimes) => {
    if (centimes === null || centimes === undefined) return '—'
    return (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  }
  const fmtDate = (d) => {
    if (!d) return '—'
    const [, m, day] = d.split('-')
    return `${day} ${MOIS_FR[parseInt(m) - 1]?.substring(0, 3)}`
  }

  const platformColor = (p) => {
    if (!p) return PLATFORM_COLORS.default
    const pl = p.toLowerCase()
    if (pl.includes('airbnb')) return PLATFORM_COLORS.airbnb
    if (pl.includes('booking')) return PLATFORM_COLORS.booking
    if (pl.includes('direct') || pl.includes('stripe')) return PLATFORM_COLORS.direct
    return PLATFORM_COLORS.default
  }
  const platformLabel = (p) => {
    if (!p) return '—'
    const pl = p.toLowerCase()
    if (pl.includes('airbnb')) return 'Airbnb'
    if (pl.includes('booking')) return 'Booking'
    if (pl.includes('direct') || pl.includes('stripe')) return 'Direct'
    return p
  }

  // Calculs Summary — accès via r.vent (structure réelle des resas)
  const honTotal    = resas.reduce((s, r) => s + (r.vent?.HON?.montant_ttc || 0), 0)
  const fmenTotal   = resas.reduce((s, r) => s + (r.vent?.FMEN?.montant_ttc || 0), 0)
  const caHeb       = resas.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const loyTotalAll = resas.reduce((s, r) => s + (r.vent?.LOY?.montant_ht || 0), 0)
  const virTotalAll = resas.reduce((s, r) => s + (r.vent?.VIR?.montant_ht || 0), 0)
  const taxeTotal   = Math.max(0, virTotalAll - loyTotalAll)
  const deboursTotal = [...extrasGlobaux, ...haownerList]
    .reduce((s, p) => s + (p.montant_ttc || p.montant || 0), 0)
    + resas.reduce((s, r) => s + (r.extra || 0), 0)
  const totalManager = honTotal + fmenTotal + deboursTotal
  const netProprio   = caHeb - totalManager
  const totalDuOwner = netProprio + taxeTotal

  const [annee, moisNum] = mois.split('-')
  const moisLabel = `${MOIS_FR[parseInt(moisNum) - 1]} ${annee}`
  const bienNom = data.bien?.hospitable_name || ''

  const STATUTS_ANNULES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']

  const lignesResas = resas.map(r => {
    const honR       = r.vent?.HON?.montant_ttc || 0
    const fmenR      = r.vent?.FMEN?.montant_ttc || 0
    const debR       = r.extra || 0
    const totalMgrR  = honR + fmenR + debR
    const loyR       = r.vent?.LOY?.montant_ht || 0
    const virR       = r.vent?.VIR?.montant_ht || 0
    const taxeR      = Math.max(0, virR - loyR)
    const isCancelled = STATUTS_ANNULES.includes(r.final_status)

    return `
    <tr style="border-bottom:1px solid #ece8e2;${isCancelled ? 'opacity:0.65;' : ''}">
      <td style="padding:4px 5px;font-size:8.5px;color:#9c8c7a;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.code || '—'}</td>
      <td style="padding:4px 5px;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${r.guest_name || '—'}${isCancelled ? ' <span style="font-size:7.5px;color:#9C8E7D;font-style:italic">(annulée)</span>' : ''}
      </td>
      <td style="padding:4px 5px;font-size:9px;white-space:nowrap">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${platformColor(r.platform)};margin-right:3px;vertical-align:middle"></span>${platformLabel(r.platform)}
      </td>
      <td style="padding:4px 5px;font-size:8.5px;white-space:nowrap">${fmtDate(r.arrival_date)} – ${fmtDate(r.departure_date)}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right">${r.nights || '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap">${fmt(r.fin_revenue)}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#9c8c7a">${honR > 0 ? fmt(honR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap">${fmenR > 0 ? fmt(fmenR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#4A3728">${debR > 0 ? fmt(debR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;font-weight:600;color:#2C2416">${totalMgrR > 0 ? fmt(totalMgrR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#9c8c7a">${taxeR > 0 ? fmt(taxeR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#CC9933;font-weight:500">${loyR > 0 ? fmt(loyR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#2d7a50;font-weight:500">${virR > 0 ? fmt(virR) : '—'}</td>
    </tr>`
  }).join('')

  const hasTransactions = extrasGlobaux.length > 0 || haownerList.length > 0
  const transactions = hasTransactions ? `
  <div style="margin-top:18px">
    <div style="font-size:8.5px;letter-spacing:0.08em;text-transform:uppercase;color:#9c8c7a;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #ece8e2">Transactions</div>
    <table style="width:100%;border-collapse:collapse;font-size:9px">
      <thead>
        <tr style="background:#EDEBE5">
          <th style="padding:4px 8px;text-align:left;font-weight:400;color:#9c8c7a">Date</th>
          <th style="padding:4px 8px;text-align:left;font-weight:400;color:#9c8c7a">Description</th>
          <th style="padding:4px 8px;text-align:left;font-weight:400;color:#9c8c7a">Type</th>
          <th style="padding:4px 8px;text-align:right;font-weight:400;color:#9c8c7a">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${extrasGlobaux.map(p => `
        <tr style="border-bottom:1px solid #ece8e2">
          <td style="padding:3px 8px;color:#9c8c7a">${p.date_prestation ? p.date_prestation.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:3px 8px">${p.libelle || p.description || '—'}</td>
          <td style="padding:3px 8px;color:#9c8c7a">Débours</td>
          <td style="padding:3px 8px;text-align:right">${fmt(p.montant)}</td>
        </tr>`).join('')}
        ${haownerList.map(p => `
        <tr style="border-bottom:1px solid #ece8e2">
          <td style="padding:3px 8px;color:#9c8c7a">${p.date_prestation ? p.date_prestation.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:3px 8px">${p.libelle || p.description || '—'}</td>
          <td style="padding:3px 8px;color:#CC9933">Achat proprio</td>
          <td style="padding:3px 8px;text-align:right;color:#CC9933">${fmt(p.montant_ttc)} TTC</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Statement — ${bienNom} — ${moisLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #2C2416; background: #fff; padding: 20px 24px; font-size: 11px; }
    @media print { body { padding: 0; } @page { size: A4 landscape; margin: 8mm 10mm; } }
  </style>
</head>
<body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid #CC9933">
  <div>
    <div style="font-size:10px;font-weight:600;color:#CC9933;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">Destination Côte Basque</div>
    <div style="font-size:17px;font-weight:700;color:#2C2416;margin-bottom:2px">${bienNom}</div>
    <div style="font-size:10px;color:#9c8c7a">${proprio?.nom || ''} · ${moisLabel}</div>
  </div>
  <div style="text-align:right;font-size:9.5px;color:#9c8c7a">
    <div style="font-weight:600;color:#2C2416;font-size:12px;margin-bottom:2px">Statement mensuel</div>
    <div>Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
    <div style="margin-top:3px;font-size:8.5px">rapports@destinationcotebasque.com</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
  <div style="background:#F7F4EC;border-radius:7px;padding:12px 14px">
    <div style="font-size:8.5px;letter-spacing:0.08em;text-transform:uppercase;color:#9c8c7a;margin-bottom:8px">Charges DCB</div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Commissions DCB (HON)</span><span style="font-weight:500">${fmt(honTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Forfaits ménage (FMEN)</span><span>${fmt(fmenTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Débours / Achats</span><span>${deboursTotal > 0 ? fmt(deboursTotal) : '—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0 0;font-weight:700;font-size:10.5px">
      <span>Total dû à DCB</span><span style="color:#CC9933">${fmt(totalManager)}</span>
    </div>
  </div>
  <div style="background:#F7F4EC;border-radius:7px;padding:12px 14px">
    <div style="font-size:8.5px;letter-spacing:0.08em;text-transform:uppercase;color:#9c8c7a;margin-bottom:8px">Reversement propriétaire</div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Total revenus voyageurs</span><span>${fmt(caHeb)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Revenus nets propriétaire</span><span>${fmt(netProprio)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Taxes de séjour</span><span>${taxeTotal > 0 ? fmt(taxeTotal) : '—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0 0;font-weight:700;font-size:10.5px">
      <span>Total reversement</span><span style="color:#2d7a50">${fmt(totalDuOwner)}</span>
    </div>
  </div>
</div>

<div style="font-size:8.5px;letter-spacing:0.08em;text-transform:uppercase;color:#9c8c7a;margin-bottom:6px">Réservations (${resas.length})</div>
<div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:900px">
    <colgroup>
      <col style="width:8%">
      <col style="width:11%">
      <col style="width:7%">
      <col style="width:9%">
      <col style="width:4%">
      <col style="width:8%">
      <col style="width:7%">
      <col style="width:7%">
      <col style="width:6%">
      <col style="width:8%">
      <col style="width:6%">
      <col style="width:9%">
      <col style="width:10%">
    </colgroup>
    <thead>
      <tr style="background:#EDEBE5;border-bottom:2px solid #CC9933">
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Code</th>
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Voyageur</th>
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Canal</th>
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Dates</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Nuits</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Brut voyageur</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">HON TTC</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">FMEN TTC</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Débours</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Total DCB</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Taxe séj.</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#CC9933">LOY</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#2d7a50">VIR</th>
      </tr>
    </thead>
    <tbody>${lignesResas}</tbody>
    <tfoot>
      <tr style="background:#EDEBE5;border-top:2px solid #CC9933;font-weight:700">
        <td colspan="5" style="padding:5px 5px;font-size:9.5px">Total</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px">${fmt(caHeb)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#9c8c7a">${fmt(honTotal)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px">${fmt(fmenTotal)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#4A3728">${deboursTotal > 0 ? fmt(deboursTotal) : '—'}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#CC9933">${fmt(totalManager)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#9c8c7a">${taxeTotal > 0 ? fmt(taxeTotal) : '—'}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#CC9933">${fmt(loyTotalAll)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#2d7a50">${fmt(totalDuOwner)}</td>
      </tr>
    </tfoot>
  </table>
</div>

${transactions}

<div style="margin-top:16px;padding-top:10px;border-top:1px solid #ece8e2;font-size:8.5px;color:#9c8c7a;display:flex;justify-content:space-between">
  <span>Destination Côte Basque — Conciergerie de prestige, Biarritz</span>
  <span>rapports@destinationcotebasque.com</span>
</div>

</body>
</html>`
}
