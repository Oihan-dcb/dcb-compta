import { supabase } from '../lib/supabase'
import { getInvoicePDFBase64 } from './evoliz'
import heroSrc from '../assets/rapport-hero.jpg?inline'
import logoSrc from '../assets/rapport-logo.png?inline'

const SVG = {
  starFull: (size=13, color='#CC9933') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-bottom:1px" fill="${color}"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`,
  starEmpty: (size=13, color='#CC9933') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin-bottom:1px" fill="none" stroke="${color}" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`,
  arrowUp: (color='#2d7a50') =>
    `<svg width="10" height="10" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle" fill="${color}"><polygon points="12,4 20,18 4,18"/></svg>`,
  arrowDown: (color='#c0392b') =>
    `<svg width="10" height="10" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle" fill="${color}"><polygon points="12,20 20,6 4,6"/></svg>`,
  stars: (rating, size=13) => {
    let s = ''
    for (let i=1; i<=5; i++) s += i <= Math.round(rating) ? SVG.starFull(size) : SVG.starEmpty(size)
    return s
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// ─────────────────────────────────────────
// Notes de marché par bien
// ─────────────────────────────────────────

export async function getBienNote(bienId, mois) {
  const { data } = await supabase
    .from('bien_notes')
    .select('note_marche')
    .eq('bien_id', bienId)
    .eq('mois', mois)
    .maybeSingle()
  return data?.note_marche || ''
}

export async function saveBienNote(bienId, mois, note) {
  const { error } = await supabase
    .from('bien_notes')
    .upsert({ bien_id: bienId, mois, note_marche: note, updated_at: new Date().toISOString() },
             { onConflict: 'bien_id,mois' })
  if (error) throw new Error('saveBienNote: ' + error.message)
}

// ─────────────────────────────────────────
// Avis clients du mois
// ─────────────────────────────────────────

export async function getReviewsMois(mois) {
  const { data, error } = await supabase
    .from('reservation_review')
    .select('id, reviewer_name, rating, comment, submitted_at, reservation:reservation_id(code, bien_id, arrival_date, bien:bien_id(hospitable_name, proprietaire_id))')
    .gte('submitted_at', mois + '-01')
    .lt('submitted_at', nextMois(mois) + '-01')
    .order('submitted_at', { ascending: false })
  if (error) throw new Error('getReviewsMois: ' + error.message)
  return data || []
}

// ─────────────────────────────────────────
// KPIs mensuels par propriétaire
// ─────────────────────────────────────────

export async function getKPIsMois(proprietaireId, mois) {
  // Réservations du mois pour ce proprio
  const { data: resas } = await supabase
    .from('reservation')
    .select('id, fin_revenue, nights, arrival_date, bien:bien_id!inner(proprietaire_id)')
    .eq('bien.proprietaire_id', proprietaireId)
    .eq('mois_comptable', mois)
    .neq('final_status', 'cancelled')

  const list = resas || []
  const nbResas = list.length
  const caHeb = list.reduce((s, r) => s + (r.fin_revenue || 0), 0)
  const revenues = list.map(r => r.fin_revenue || 0).filter(v => v > 0)
  const durees = list.map(r => r.nights || 0).filter(v => v > 0)
  const prixMoy = revenues.length ? Math.round(revenues.reduce((s, v) => s + v, 0) / revenues.length) : 0
  const prixMin = revenues.length ? Math.min(...revenues) : 0
  const prixMax = revenues.length ? Math.max(...revenues) : 0
  const dureeMoy = durees.length ? (durees.reduce((s, v) => s + v, 0) / durees.length).toFixed(1) : 0

  // Nuits occupées
  const nuitsOccupees = durees.reduce((s, v) => s + v, 0)

  // Nuits disponibles = nb biens × nb jours du mois
  const { data: biens } = await supabase
    .from('bien')
    .select('id')
    .eq('proprietaire_id', proprietaireId)
    .eq('actif', true)
    .eq('agence', 'dcb')
  const nbBiens = (biens || []).length
  const [y, m] = mois.split('-').map(Number)
  const nuitsDispos = nbBiens * new Date(y, m, 0).getDate()
  const revpar = nuitsDispos > 0 ? Math.round((caHeb / nuitsDispos) * 100) / 100 : 0

  // LOY total depuis ventilation
  const { data: ventLoy } = await supabase
    .from('ventilation')
    .select('montant_ht, reservation:reservation_id!inner(bien:bien_id!inner(proprietaire_id))')
    .eq('code', 'LOY')
    .eq('mois_comptable', mois)
    .eq('reservation.bien.proprietaire_id', proprietaireId)
  const loyTotal = (ventLoy || []).reduce((s, v) => s + (v.montant_ht || 0), 0)

  return { nbResas, caHeb, prixMoy, prixMin, prixMax, dureeMoy, revpar, nuitsOccupees, nuitsDispos, loyTotal }
}

// ─────────────────────────────────────────
// Génération HTML rapport
// ─────────────────────────────────────────

export function genererRapportHTML(proprio, mois, data) {
  const { kpis, resas, reviews, notes, bien, llmAnalyse, llmContexte, llmTendances, kpisN1, noteMoisMoy, noteGlobaleMoy, nbReviewsGlobal, noteContexte, noteReco, tauxCommission, extrasGlobaux = [], haownerList = [] } = data
  const [year, monthIdx] = mois.split('-')
  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year
  const fmt = (c) => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const bienName = bien?.hospitable_name || proprio?.nom || ''
  const prixMoyenNuit = kpis.nuitsOccupees > 0 ? Math.round((kpis.caHeb / kpis.nuitsOccupees) / 100) : 0

  const PLATFORM_LABELS = { airbnb: 'Airbnb', booking: 'Booking', stripe: 'Direct', direct: 'Direct' }
  const PLATFORM_COLORS = { airbnb: '#FF5A5F', booking: '#003580', stripe: '#059669', direct: '#059669' }

  const resasHTML = (resas || []).length
    ? `<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;margin-top:6px;">
        <colgroup>
          <col style="width:8%">
          <col style="width:8%">
          <col style="width:18%">
          <col style="width:6%">
          <col style="width:9%">
          <col style="width:17%">
          <col style="width:11%">
          <col style="width:12%">
          <col style="width:11%">
        </colgroup>
        <thead>
          <tr style="background:#EDEBE5;">
            <th style="padding:5px 5px;text-align:left;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Arrivée</th>
            <th style="padding:5px 5px;text-align:left;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Départ</th>
            <th style="padding:5px 5px;text-align:left;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Voyageur</th>
            <th style="padding:5px 4px;text-align:center;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Nuits</th>
            <th style="padding:5px 4px;text-align:center;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Canal</th>
            <th style="padding:5px 4px;text-align:right;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Base comm.</th>
            <th style="padding:5px 4px;text-align:right;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">HON</th>
            <th style="padding:5px 4px;text-align:right;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">LOY</th>
            <th style="padding:5px 4px;text-align:right;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">VIR</th>
          </tr>
        </thead>
        <tbody>
          ${(resas || []).map((r, i) => {
            const plat = (r.platform || '').toLowerCase()
            const platLabel = PLATFORM_LABELS[plat] || r.platform || '—'
            const platColor = PLATFORM_COLORS[plat] || '#9C8E7D'
            const v = r.vent || {}
            const arrFR = r.arrival_date ? r.arrival_date.substring(5).split('-').reverse().join('/') : '—'
            const depFR = r.departure_date ? r.departure_date.substring(5).split('-').reverse().join('/') : '—'
            return `<tr style="background:${i % 2 === 0 ? '#F7F4EF' : '#fff'};">
              <td style="padding:5px 5px;color:#2C2416;white-space:nowrap;">${arrFR}</td>
              <td style="padding:5px 5px;color:#4A3728;white-space:nowrap;">${depFR}</td>
              <td style="padding:5px 5px;color:#2C2416;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.guest_name || '—'}</td>
              <td style="padding:5px 4px;text-align:center;color:#4A3728;">${r.nights || '—'}</td>
              <td style="padding:5px 4px;text-align:center;">
                <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${platColor};margin-right:3px;vertical-align:middle;"></span>
                <span style="color:#4A3728;">${platLabel}</span>
              </td>
              <td style="padding:5px 4px;text-align:right;color:#2C2416;white-space:nowrap;">${fmt(r.fin_revenue)}</td>
              <td style="padding:5px 4px;text-align:right;white-space:nowrap;color:#9c8c7a;">${v.HON ? fmt(v.HON.montant_ttc) : '—'}</td>
              <td style="padding:5px 4px;text-align:right;font-weight:500;white-space:nowrap;color:#CC9933;">${v.LOY ? fmt(v.LOY.montant_ht) : '—'}</td>
              <td style="padding:5px 4px;text-align:right;white-space:nowrap;color:#2d7a50;">${v.VIR ? fmt(v.VIR.montant_ht) : '—'}</td>
            </tr>`}).join('')}
        </tbody>
      </table>`
    : '<p style="color:#9C8E7D;font-style:italic;font-size:0.9em;margin:8px 0 0;">Aucune réservation ce mois.</p>'

  const reviewsHTML = reviews.length
    ? reviews.map(r => `
      <div class="avis-block" style="border-left:3px solid #CC9933;padding:8px 14px;margin-bottom:8px;background:#F7F4EF;border-radius:0 6px 6px 0;">
        <div style="color:#CC9933;font-size:1em;margin-bottom:3px;">${SVG.stars(r.rating || 0, 13)}</div>
        <p style="margin:0;color:#2C2416;font-style:italic;line-height:1.5;font-size:13px;">«&nbsp;${r.comment || ''}&nbsp;»</p>
      </div>`).join('')
    : '<p style="color:#9C8E7D;font-style:italic;font-size:0.9em;">Aucun avis reçu ce mois.</p>'

  const cleanForPdf = (text) => {
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

  const llmHTML = llmAnalyse
    ? `<p style="margin:0 0 10px;line-height:1.7;font-size:13px;color:#2C2416;">${cleanForPdf(llmAnalyse)}</p>`
    : ''

  const noteMarche = (notes || []).find(n => n.note)?.note || ''
  const noteHTML = noteMarche
    ? `<p style="margin:0;color:#2C2416;line-height:1.7;font-size:0.95em;">${noteMarche.replace(/\n/g, '<br/>')}</p>`
    : ''

  const deltaOcc = kpisN1?.tauxOcc != null ? kpis.tauxOcc - kpisN1.tauxOcc : null
  const deltaCA = kpisN1?.caHeb != null ? kpis.caHeb - kpisN1.caHeb : null

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport ${bienName} — ${moisLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'DM Sans',Arial,sans-serif; background:#F7F4EF; color:#2C2416; -webkit-font-smoothing:antialiased; }
  .container { max-width:680px; margin:0 auto; background:#fff; }
  .section { padding:14px 24px; border-bottom:1px solid #EDEBE5; }
  .section-title { font-size:0.68em; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#CC9933; margin-bottom:10px; }
  .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .kpi { background:#F7F4EF; border:1px solid #EDEBE5; border-radius:8px; padding:10px 8px; text-align:center; }
  .kpi-val { font-size:18px; font-weight:700; color:#2C2416; }
  .kpi-lbl { font-size:8px; color:#9C8E7D; margin-top:3px; text-transform:uppercase; letter-spacing:0.5px; }
  .kpi-delta { font-size:0.7em; margin-top:2px; }
  .footer { text-align:center; padding:12px 24px; font-size:0.75em; color:#9C8E7D; background:#F7F4EF; border-top:2px solid #CC9933; }
  img { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: A4 portrait; margin: 8mm 6mm; }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; padding: 0; }
    .container { max-width:100% !important; }
    img { max-width:100% !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .section-kpis,
    .section-synthese,
    .section-analyse,
    .section-sejours,
    .section-avis,
    .section-contexte,
    .section-perspectives,
    table,
    .avis-block,
    .kpi-grid {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .section-sejours,
    .section-avis {
      page-break-before: auto;
      break-before: auto;
    }
    p {
      page-break-inside: avoid;
      break-inside: avoid;
      orphans: 3;
      widows: 3;
    }
    img { max-width:100% !important; page-break-inside:avoid; }
    img[src^="data:"] {
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
  }
</style>
</head>
<body>
<div class="container">

  <!-- HERO + KPIs financiers intégrés -->
  <div class="section-synthese" style="position:relative;height:230px;display:block;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;">
    <img src="${heroSrc}"
      style="position:absolute;top:0;left:0;width:100%;height:230px;object-fit:cover;object-position:center 35%;display:block;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;"/>
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,14,8,0.15) 0%,rgba(20,14,8,0.72) 100%);-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;"></div>
    <!-- Logo + Titre centrés + KPIs financiers -->
    <!-- Titres centrés en haut du hero -->
    <div style="position:absolute;top:0;left:0;right:0;bottom:175px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <div style="font-size:9px;letter-spacing:0.05em;text-transform:uppercase;color:#fff;margin-bottom:4px;white-space:nowrap;">Rapport mensuel · ${moisLabel}</div>
      <div style="font-size:16px;font-weight:400;color:#fff;letter-spacing:0.02em;white-space:nowrap;">${proprio?.nom || ''} — ${bienName}</div>
    </div>
    <!-- Logo plus bas et plus grand -->
    <div style="position:absolute;bottom:-2px;left:0;right:0;text-align:center;">
      <img src="${logoSrc}"
        style="height:200px;display:block;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;" onerror="this.style.display='none'"/>
    </div>
    <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top,rgba(20,14,8,0.88) 0%,transparent 100%);">
      <div style="display:flex;justify-content:space-around;padding:10px 24px 14px;">
      <div style="text-align:center;">
        <div style="font-size:8px;letter-spacing:0.04em;text-transform:uppercase;color:rgba(212,196,176,0.8);margin-bottom:3px;">Base commissionnable</div>
        <div style="font-size:18px;font-weight:400;color:#fff;">${fmt(kpis.caHeb)}</div>
        ${deltaCA !== null ? `<div style="font-size:9px;color:${deltaCA >= 0 ? '#4ADE80' : '#F87171'};">${deltaCA >= 0 ? SVG.arrowUp('#4ADE80') : SVG.arrowDown('#F87171')} vs N-1</div>` : ''}
      </div>
      <div style="text-align:center;border-left:1px solid rgba(204,153,51,0.4);border-right:1px solid rgba(204,153,51,0.4);padding:0 20px;">
        <div style="font-size:8px;letter-spacing:0.04em;text-transform:uppercase;color:#CC9933;margin-bottom:3px;">Honoraires DCB</div>
        <div style="font-size:18px;font-weight:400;color:#CC9933;">${fmt(kpis.honTotal)}</div>
        <div style="font-size:9px;color:rgba(204,153,51,0.7);">${tauxCommission ? tauxCommission + '% TTC' : 'gestion & services'}</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:8px;letter-spacing:0.04em;text-transform:uppercase;color:rgba(212,196,176,0.8);margin-bottom:3px;">Virement propriétaire</div>
        <div style="font-size:18px;font-weight:400;color:#fff;">${fmt(kpis.virementNet ?? kpis.loyTotal)}</div>
      </div>
      </div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="section section-kpis">
    <div class="section-title">Indicateurs du mois</div>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-val">${kpis.nbResas}</div>
        <div class="kpi-lbl">Réservations</div>
        ${kpisN1?.nbResas != null ? `<div class="kpi-delta" style="color:${kpis.nbResas >= kpisN1.nbResas ? '#059669' : '#DC2626'};">${kpis.nbResas >= kpisN1.nbResas ? SVG.arrowUp('#059669') : SVG.arrowDown('#DC2626')} N-1 : ${kpisN1.nbResas}</div>` : ''}
      </div>
      <div class="kpi">
        <div class="kpi-val">${kpis.tauxOcc}%</div>
        <div class="kpi-lbl">Taux d'occupation</div>
        ${deltaOcc !== null ? `<div class="kpi-delta" style="color:${deltaOcc >= 0 ? '#059669' : '#DC2626'};">${deltaOcc >= 0 ? SVG.arrowUp('#059669') : SVG.arrowDown('#DC2626')} ${Math.abs(deltaOcc)} pts</div>` : ''}
      </div>
      <div class="kpi">
        <div class="kpi-val">${kpis.nuitsOccupees}/${kpis.nuitsDispos}</div>
        <div class="kpi-lbl">Nuits occ./dispo.</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${prixMoyenNuit > 0 ? prixMoyenNuit + ' €' : '—'}</div>
        <div class="kpi-lbl">Prix moy./nuit</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${kpis.dureeMoy} nuits</div>
        <div class="kpi-lbl">Durée moyenne</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${noteMoisMoy ? SVG.starFull(14) + ' ' + noteMoisMoy : '—'}</div>
        <div class="kpi-lbl">Note voyageurs</div>
        ${nbReviewsGlobal > 0 ? `<div class="kpi-delta" style="color:#9C8E7D;">${SVG.starFull(11,'#9C8E7D')} ${noteGlobaleMoy} global (${nbReviewsGlobal})</div>` : ''}
      </div>
    </div>
  </div>

  ${llmHTML ? `
  <!-- ANALYSE DU MOIS -->
  <div class="section section-analyse">
    <div class="section-title">Analyse du mois</div>
    <div style="border-left:3px solid #CC9933;padding-left:18px;">
      ${llmHTML}
    </div>
  </div>` : ''}

  <!-- RÉSERVATIONS -->
  <div class="section section-sejours">
    <div class="section-title">Séjours du mois (${(resas || []).length})</div>
    ${resasHTML}
  </div>

  ${(extrasGlobaux.length > 0 || haownerList.length > 0) ? `
  <div style="margin:16px 0;padding:20px 24px;background:#F7F4EF;break-inside:avoid;">
    <div style="font-size:9px;letter-spacing:0.05em;text-transform:uppercase;color:#9c8c7a;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #ece8e2;">
      Débours et achats du mois
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;">
      <colgroup>
        <col style="width:12%">
        <col style="width:9%">
        <col style="width:64%">
        <col style="width:15%">
      </colgroup>
      <thead>
        <tr style="background:#EDEBE5;">
          <th style="padding:6px 8px;text-align:left;font-weight:400;font-size:9px;color:#9c8c7a;">Date</th>
          <th style="padding:6px 8px;text-align:left;font-weight:400;font-size:9px;color:#9c8c7a;">Type</th>
          <th style="padding:6px 8px;text-align:left;font-weight:400;font-size:9px;color:#9c8c7a;">Description</th>
          <th style="padding:6px 8px;text-align:right;font-weight:400;font-size:9px;color:#9c8c7a;">Montant</th>
        </tr>
      </thead>
      <tbody>
        ${extrasGlobaux.map((p, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : '#F7F4EF'};">
          <td style="padding:6px 8px;color:#3a3530;">${p.date_prestation ? p.date_prestation.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:6px 8px;color:#9c8c7a;font-size:10px;">Débours</td>
          <td style="padding:6px 8px;color:#3a3530;">${p.libelle || p.description || '—'}</td>
          <td style="padding:6px 8px;text-align:right;white-space:nowrap;color:#4A3728;">${fmt(p.montant)}</td>
        </tr>`).join('')}
        ${haownerList.map((p, i) => `
        <tr style="background:${(extrasGlobaux.length + i) % 2 === 0 ? '#fff' : '#F7F4EF'};">
          <td style="padding:6px 8px;color:#3a3530;">${p.date_prestation ? p.date_prestation.substring(5).split('-').reverse().join('/') : '—'}</td>
          <td style="padding:6px 8px;color:#CC9933;font-size:10px;">Achat</td>
          <td style="padding:6px 8px;color:#3a3530;">${p.libelle || p.description || '—'}</td>
          <td style="padding:6px 8px;text-align:right;white-space:nowrap;color:#CC9933;font-weight:500;">${fmt(p.montant_ttc)} <span style="font-size:9px;color:#9c8c7a;">TTC</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${reviews.length ? `
  <!-- AVIS -->
  <div class="section section-avis">
    <div class="section-title">Avis voyageurs (${reviews.length}${noteMoisMoy ? ' · ' + SVG.starFull(12) + ' ' + noteMoisMoy + '/5' : ''})</div>
    ${reviewsHTML}
  </div>` : ''}

  ${llmContexte ? `
  <!-- CONTEXTE MARCHÉ -->
  <div class="section section-contexte" style="background:#F7F4EF;">
    <div class="section-title">Contexte marché</div>
    <p style="margin:0 0 10px;line-height:1.7;font-size:13px;color:#2C2416;">${cleanForPdf(llmContexte)}</p>
  </div>` : noteContexte ? `
  <!-- CONTEXTE -->
  <div class="section section-contexte">
    <div class="section-title">Contexte & tendances</div>
    <p style="margin:0;color:#2C2416;line-height:1.7;font-size:0.95em;">${noteContexte.replace(/\n/g, '<br/>')}</p>
  </div>` : noteHTML ? `
  <!-- NOTE MARCHÉ -->
  <div class="section section-contexte">
    <div class="section-title">Note de marché</div>
    ${noteHTML}
  </div>` : ''}

  ${llmTendances ? `
  <!-- PERSPECTIVES -->
  <div class="section section-perspectives">
    <div class="section-title">Perspectives M+1/M+2</div>
    <div style="border-left:3px solid #CC9933;padding-left:18px;">
      <p style="margin:0 0 10px;line-height:1.7;font-size:13px;color:#2C2416;">${cleanForPdf(llmTendances)}</p>
    </div>
  </div>` : ''}

  ${noteReco ? `
  <!-- RECOMMANDATIONS -->
  <div class="section section-synthese" style="background:#FDFAF7;">
    <div class="section-title">Recommandations DCB</div>
    <p style="margin:0;color:#2C2416;line-height:1.7;font-size:0.95em;">${noteReco.replace(/\n/g, '<br/>')}</p>
  </div>` : ''}

  <div class="footer">
    <div style="margin-bottom:4px;">Destination Côte Basque — Conciergerie de prestige, Biarritz</div>
    <div>Rapport généré le ${new Date().toLocaleDateString('fr-FR')} · contact@destinationcotebasque.com</div>
  </div>

</div>
</body>
</html>`
}
// ─────────────────────────────────────────
// Envoi email via Edge Function smtp-send
// ─────────────────────────────────────────

export async function envoyerRapportEmail(proprio, mois, htmlBody) {
  const [year, monthIdx] = mois.split('-')
  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year

  if (!proprio.email) throw new Error(`Pas d'email pour ${proprio.nom}`)

  // Récupérer le PDF de la facture honoraires si disponible
  let attachments = []
  try {
    const { data: facture } = await supabase
      .from('facture_evoliz')
      .select('id_evoliz')
      .eq('proprietaire_id', proprio.id)
      .eq('mois', mois)
      .eq('type_facture', 'honoraires')
      .not('id_evoliz', 'is', null)
      .maybeSingle()

    if (facture?.id_evoliz) {
      const pdfBase64 = await getInvoicePDFBase64(facture.id_evoliz)
      if (pdfBase64) {
        attachments = [{
          filename: `Facture_${moisLabel.replace(' ', '_')}_${proprio.nom}.pdf`,
          content_base64: pdfBase64,
        }]
      }
    }
  } catch (e) {
    console.warn('PDF Evoliz non disponible, envoi sans pièce jointe:', e.message)
  }

  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      to: proprio.email,
      cc: 'oihan@destinationcotebasque.com',
      subject: `Rapport mensuel ${moisLabel} — Destination Côte Basque`,
      html: htmlBody,
      attachments: attachments.length ? attachments : undefined,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`smtp-send: ${err}`)
  }
  return true
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function nextMois(mois) {
  const [y, m] = mois.split('-').map(Number)
  if (m === 12) return `${y + 1}-01`
  return `${y}-${String(m + 1).padStart(2, '0')}`
}
