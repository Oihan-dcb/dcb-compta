function escapeNonAscii(s) {
  return s.replace(/[^\x00-\x7F]/g, c => `&#${c.codePointAt(0)};`)
}

const PLATFORM_COLORS = { airbnb: '#FF5A5F', booking: '#003580', direct: '#2d7a50', stripe: '#2d7a50', default: '#9C8E7D' }
const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']

export function genererStatementHTML(proprio, mois, data) {
  const resas = data.resas || []
  const extrasGlobaux = data.extrasGlobaux || []
  const extrasParResa = data.extrasParResa || []
  const haownerList = data.haownerList || []
  const ownerStayMenageList = data.ownerStayMenageList || []
  const fraisProprietaire = data.fraisProprietaire || []

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

  // Calculs Summary — valeurs pré-calculées dans PageRapports.jsx (r.hon, r.vir, etc.)
  const honTotal      = resas.reduce((s, r) => s + (r.hon  || 0), 0)
  const menageTotal   = resas.reduce((s, r) => s + (r.menage_voyageur || 0), 0)
  const grossTotal    = resas.reduce((s, r) => s + ((r.gross_revenue ?? r.fin_revenue) || 0), 0)
  const caHeb         = resas.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const virTotal      = resas.reduce((s, r) => s + (r.vir  || 0), 0)
  const taxeTotal     = resas.reduce((s, r) => s + (r.taxe || 0), 0)
  const baseCommTotal = resas.reduce((s, r) => s + (r.base_comm || 0), 0)
  const deboursTotal  = [...extrasGlobaux, ...haownerList]
    .reduce((s, p) => s + (p.montant_ttc || p.montant || 0), 0)
    + resas.reduce((s, r) => s + (r.extra || 0), 0)
    + resas.filter(r => r.owner_stay && r.platform === 'manual').reduce((s, r) => s + (r.menage_voyageur || 0), 0)
  const totalManager  = honTotal + menageTotal + deboursTotal
  // virementNet vient de buildRapportData (source de vérité unique) — inclut déjà les remboursements
  const virementNet   = data.kpis?.virementNet ?? 0
  const netProprio    = virementNet
  const totalDuOwner  = virementNet
  // Remboursements visibles dans le bloc reversement
  const remboursementsList = fraisProprietaire.filter(f => f.mode_traitement === 'remboursement' && f.statut !== 'brouillon')
  const remboursementsTotal = remboursementsList.reduce((s, f) => s + (f.montant_ttc || 0), 0)

  const [annee, moisNum] = mois.split('-')
  const moisLabel = `${MOIS_FR[parseInt(moisNum) - 1]} ${annee}`
  const bienNom = data.bien?.hospitable_name || ''

  const STATUTS_ANNULES = ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired']

  const lignesResas = resas.map(r => {
    const honR  = r.hon  || 0
    const virR  = r.vir  || 0
    const taxeR = r.taxe || 0
    const menR  = r.menage_voyageur || 0
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
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap">${fmt(r.gross_revenue ?? r.fin_revenue)}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#4A3728">${fmt(r.fin_revenue || 0)}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#4A3728">${(r.base_comm || 0) > 0 ? fmt(r.base_comm) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#9c8c7a">${honR > 0 ? fmt(honR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#4A3728">${menR > 0 ? fmt(menR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#9c8c7a">${taxeR > 0 ? fmt(taxeR) : '—'}</td>
      <td style="padding:4px 5px;font-size:9px;text-align:right;white-space:nowrap;color:#2d7a50;font-weight:500">${virR > 0 ? fmt(virR) : '—'}</td>
    </tr>`
  }).join('')

  const hasTransactions = extrasGlobaux.length > 0 || extrasParResa.length > 0 || haownerList.length > 0 || ownerStayMenageList.length > 0 || fraisProprietaire.length > 0
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
        ${extrasParResa.map(p => `
        <tr style="border-bottom:1px solid #ece8e2">
          <td style="padding:3px 8px;color:#9c8c7a">${p.date_prestation ? p.date_prestation.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:3px 8px">${p.libelle || p.description || '—'}</td>
          <td style="padding:3px 8px;color:#9c8c7a">Débours (résa)</td>
          <td style="padding:3px 8px;text-align:right">${fmt(p.montant)}</td>
        </tr>`).join('')}
        ${haownerList.map(p => `
        <tr style="border-bottom:1px solid #ece8e2">
          <td style="padding:3px 8px;color:#9c8c7a">${p.date_prestation ? p.date_prestation.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:3px 8px">${p.libelle || p.description || '—'}</td>
          <td style="padding:3px 8px;color:#CC9933">Achat proprio</td>
          <td style="padding:3px 8px;text-align:right;color:#CC9933">${fmt(p.montant_ttc)} TTC</td>
        </tr>`).join('')}
        ${ownerStayMenageList.map(p => `
        <tr style="border-bottom:1px solid #ece8e2">
          <td style="padding:3px 8px;color:#9c8c7a">${p.arrival_date ? p.arrival_date.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:3px 8px">${p.libelle || 'Ménage séjour propriétaire'}</td>
          <td style="padding:3px 8px;color:#4A3728">Ménage proprio</td>
          <td style="padding:3px 8px;text-align:right;color:#4A3728">${fmt(p.montant)}</td>
        </tr>`).join('')}
        ${fraisProprietaire.map(p => `
        <tr style="border-bottom:1px solid #ece8e2">
          <td style="padding:3px 8px;color:#9c8c7a">${p.date ? p.date.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:3px 8px">${p.libelle || '—'}</td>
          <td style="padding:3px 8px;color:#c2410c">Frais proprio</td>
          <td style="padding:3px 8px;text-align:right;color:#c2410c">${fmt(p.montant_ttc)}</td>
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
    <div style="margin-top:3px;font-size:8.5px">oihan@destinationcotebasque.com</div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
  <div style="background:#F7F4EC;border-radius:7px;padding:12px 14px">
    <div style="font-size:8.5px;letter-spacing:0.08em;text-transform:uppercase;color:#9c8c7a;margin-bottom:8px">Charges DCB</div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Commissions DCB (HON)</span><span style="font-weight:500">${fmt(honTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Ménage total (voyageurs)</span><span>${fmt(menageTotal)}</span>
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
      <span style="color:#9c8c7a">Total revenus voyageurs (brut)</span><span>${fmt(grossTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Net reçu plateforme</span><span>${fmt(caHeb)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Réversement brut (VIR)</span><span>${fmt(virTotal)}</span>
    </div>
    ${deboursTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#9c8c7a">Débours / Achats</span><span style="color:#DC2626">− ${fmt(deboursTotal)}</span>
    </div>` : ''}
    ${remboursementsTotal > 0 ? remboursementsList.map(f => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #ece8e2;font-size:10px">
      <span style="color:#059669">${escapeNonAscii(f.libelle || 'Remboursement')}</span><span style="color:#059669">+ ${fmt(f.montant_ttc)}</span>
    </div>`).join('') : ''}
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
      <col style="width:10%">
      <col style="width:7%">
      <col style="width:9%">
      <col style="width:4%">
      <col style="width:9%">
      <col style="width:9%">
      <col style="width:9%">
      <col style="width:8%">
      <col style="width:9%">
      <col style="width:6%">
      <col style="width:12%">
    </colgroup>
    <thead>
      <tr style="background:#EDEBE5;border-bottom:2px solid #CC9933">
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Code</th>
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Voyageur</th>
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Canal</th>
        <th style="padding:5px 5px;text-align:left;font-weight:400;font-size:8px;color:#9c8c7a">Dates</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Nuits</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Brut voyageur</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Net plateforme</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Base comm.</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">HON TTC</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Ménage total</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#9c8c7a">Taxe séj.</th>
        <th style="padding:5px 5px;text-align:right;font-weight:400;font-size:8px;color:#2d7a50">VIR</th>
      </tr>
    </thead>
    <tbody>${lignesResas}</tbody>
    <tfoot>
      <tr style="background:#EDEBE5;border-top:2px solid #CC9933;font-weight:700">
        <td colspan="5" style="padding:5px 5px;font-size:9.5px">Total</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px">${fmt(grossTotal)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#4A3728">${fmt(caHeb)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#4A3728">${baseCommTotal > 0 ? fmt(baseCommTotal) : '—'}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#9c8c7a">${fmt(honTotal)}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#4A3728">${menageTotal > 0 ? fmt(menageTotal) : '—'}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#9c8c7a">${taxeTotal > 0 ? fmt(taxeTotal) : '—'}</td>
        <td style="padding:5px 5px;text-align:right;font-size:9.5px;color:#2d7a50">${fmt(virTotal)}</td>
      </tr>
    </tfoot>
  </table>
</div>

${transactions}

<div style="margin-top:16px;padding-top:10px;border-top:1px solid #ece8e2;font-size:8.5px;color:#9c8c7a;display:flex;justify-content:space-between">
  <span>Destination Côte Basque — Conciergerie de prestige, Biarritz</span>
  <span>oihan@destinationcotebasque.com</span>
</div>

</body>
</html>`
}

// ─────────────────────────────────────────
// Corps du mail quand useStatement = true
// Contenu : KPIs intro + LLM + avis voyageurs (sans tableau financier)
// Le statement complet est en pièce jointe PDF
// ─────────────────────────────────────────

const SVG_STAR_FULL = (size = 13, color = '#CC9933') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-bottom:1px" fill="${color}"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`
const SVG_STAR_EMPTY = (size = 13, color = '#CC9933') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-bottom:1px" fill="none" stroke="${color}" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`
const svgStars = (rating, size = 13) => {
  let s = ''
  for (let i = 1; i <= 5; i++) s += i <= Math.round(rating) ? SVG_STAR_FULL(size) : SVG_STAR_EMPTY(size)
  return s
}

export function genererMailStatementHTML(proprio, mois, data) {
  const [annee, moisNum] = mois.split('-')
  const moisLabel = `${MOIS_FR[parseInt(moisNum) - 1]} ${annee}`
  const bienNom = data.bien?.hospitable_name || proprio?.nom || ''
  const kpis = data.kpis || {}
  const reviews = data.reviews || []
  const noteMoisMoy = data.noteMoisMoy

  const fmtEur = (c) => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

  const cleanLLM = (text) => {
    if (!text) return ''
    return text
      .replace(/^#+\s+.+\n?/gm, '')
      .replace(/^-{3,}\n?/gm, '')
      .replace(/^\*\*[A-Z][^*\n]{0,40}\*\*\s*[-:]\s*\n?/gm, '')
      .replace(/^\*\*[A-Z][^*\n]{0,40}\*\*\s*\n/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n+/g, '</p><p style="margin:0 0 10px;line-height:1.7;font-size:13px;color:#2C2416;">')
      .replace(/\n/g, '<br/>')
      .trim()
  }

  const kpiBlock = `
<div style="display:flex;gap:12px;margin:16px 0 4px;">
  ${kpis.nbResas != null ? `<div style="flex:1;background:#F7F4EF;border:1px solid #EDEBE5;border-radius:8px;padding:12px 8px;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#2C2416;">${kpis.nbResas}</div>
    <div style="font-size:9px;color:#9C8E7D;text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">Reservations</div>
  </div>` : ''}
  ${kpis.caHeb != null ? `<div style="flex:1;background:#F7F4EF;border:1px solid #EDEBE5;border-radius:8px;padding:12px 8px;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#CC9933;">${fmtEur(kpis.caHeb)}</div>
    <div style="font-size:9px;color:#9C8E7D;text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">CA hebergement</div>
  </div>` : ''}
  ${noteMoisMoy != null ? `<div style="flex:1;background:#F7F4EF;border:1px solid #EDEBE5;border-radius:8px;padding:12px 8px;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#2C2416;">${SVG_STAR_FULL(16)} ${noteMoisMoy}</div>
    <div style="font-size:9px;color:#9C8E7D;text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">Note voyageurs</div>
  </div>` : ''}
  <div style="flex:1;text-align:center;padding:16px 8px;background:#fff;border-radius:8px;border:1px solid #e8e3db;">
    <div style="font-size:24px;line-height:1;margin-bottom:6px;">&#128206;</div>
    <div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#9c8c7a;margin-top:4px;">STATEMENT PDF</div>
    <div style="font-size:10px;color:#9c8c7a;margin-top:2px;">En piece jointe</div>
  </div>
</div>`

  const llmBlock = (label, text) => {
    if (!text) return ''
    const cleaned = cleanLLM(text)
    return `
<div style="padding:14px 20px;border-bottom:1px solid #EDEBE5;">
  <div style="font-size:0.68em;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#CC9933;margin-bottom:10px;">${label}</div>
  <p style="margin:0 0 10px;line-height:1.7;font-size:13px;color:#2C2416;">${cleaned}</p>
</div>`
  }

  // Échapper les non-ASCII du contenu LLM (provient de l'API Anthropic, contient accents)
  const safeAnalyse   = escapeNonAscii(data.llmAnalyse   || '')
  const safeContexte  = escapeNonAscii(data.llmContexte  || '')
  const safeTendances = escapeNonAscii(data.llmTendances || '')
  const safeReviews   = reviews.map(r => ({ ...r, comment: escapeNonAscii(r.comment || '') }))

  const reviewsBlock = safeReviews.length ? `
<div style="padding:14px 20px;border-bottom:1px solid #EDEBE5;">
  <div style="font-size:0.68em;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#CC9933;margin-bottom:10px;">Avis voyageurs (${safeReviews.length}${noteMoisMoy ? ' - ' + SVG_STAR_FULL(12) + ' ' + noteMoisMoy + '/5' : ''})</div>
  ${safeReviews.map(r => `<div style="border-left:3px solid #CC9933;padding:8px 14px;margin-bottom:8px;background:#F7F4EF;border-radius:0 6px 6px 0;">
    <div style="color:#CC9933;font-size:1em;margin-bottom:3px;">${svgStars(r.rating || 0, 13)}</div>
    <p style="margin:0;color:#2C2416;font-style:italic;line-height:1.5;font-size:13px;">&#171; ${r.comment} &#187;</p>
  </div>`).join('')}
</div>` : ''

  const hasContent = safeAnalyse || safeContexte || safeTendances || safeReviews.length

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bienNom} — ${moisLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'DM Sans',Arial,sans-serif; background:#F7F4EF; color:#2C2416; -webkit-font-smoothing:antialiased; }
  .container { max-width:680px; margin:0 auto; background:#fff; }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div style="padding:20px 24px 16px;border-bottom:2px solid #CC9933;background:#fff;">
    <div style="font-size:0.65em;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#CC9933;margin-bottom:4px;">Destination Côte Basque</div>
    <div style="font-size:1.25em;font-weight:700;color:#2C2416;">${bienNom}</div>
    <div style="font-size:0.85em;color:#9C8E7D;margin-top:2px;">${moisLabel}</div>
  </div>

  <!-- Intro + KPIs -->
  <div style="padding:14px 24px;border-bottom:1px solid #EDEBE5;font-size:13px;color:#2C2416;line-height:1.7;">
    Veuillez trouver ci-dessous le résumé du mois de ${moisLabel.toLowerCase()} pour votre bien.
    Le détail financier complet est disponible en pièce jointe (statement PDF).
    ${kpiBlock}
  </div>

  ${!hasContent ? `<div style="padding:20px 24px;font-size:13px;color:#9C8E7D;font-style:italic;">Aucun commentaire disponible pour ce mois.</div>` : ''}

  ${llmBlock('Analyse du mois', safeAnalyse)}
  ${llmBlock('Contexte march&#233;', safeContexte)}
  ${llmBlock('Perspectives', safeTendances)}
  ${reviewsBlock}

  <!-- Footer -->
  <div style="text-align:center;padding:12px 24px;font-size:0.75em;color:#9C8E7D;background:#F7F4EF;border-top:2px solid #CC9933;">
    Destination Côte Basque · oihan@destinationcotebasque.com<br>
    Conciergerie de prestige — Biarritz
  </div>

</div>
</body>
</html>`
  return escapeNonAscii(html)
}
