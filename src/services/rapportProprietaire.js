import { supabase } from '../lib/supabase'
import { getInvoicePDFBase64 } from './evoliz'

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
  const { kpis, resas, reviews, notes, bien, llmAnalyse, kpisN1, noteMoisMoy, noteGlobaleMoy, nbReviewsGlobal } = data
  const [year, monthIdx] = mois.split('-')
  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year
  const fmt = (c) => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const bienName = bien?.hospitable_name || proprio?.nom || ''
  const prixMoyenNuit = kpis.nuitsOccupees > 0 ? Math.round((kpis.caHeb / kpis.nuitsOccupees) / 100) : 0

  const PLATFORM_LABELS = { airbnb: 'Airbnb', booking: 'Booking', stripe: 'Direct', direct: 'Direct' }
  const PLATFORM_COLORS = { airbnb: '#FF5A5F', booking: '#003580', stripe: '#059669', direct: '#059669' }

  const resasHTML = (resas || []).length
    ? `<table style="width:100%;border-collapse:collapse;font-size:0.88em;margin-top:8px;">
        <thead>
          <tr style="background:#EDEBE5;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Arrivée</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Départ</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Voyageur</th>
            <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Nuits</th>
            <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Canal</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Base comm.</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #CC9933;color:#2C2416;font-weight:600;">Reversement</th>
          </tr>
        </thead>
        <tbody>
          ${(resas || []).map((r, i) => {
            const plat = (r.platform || '').toLowerCase()
            const platLabel = PLATFORM_LABELS[plat] || r.platform || '—'
            const platColor = PLATFORM_COLORS[plat] || '#9C8E7D'
            const v = r.vent || {}
            const arrFR = r.arrival_date ? r.arrival_date.split('-').reverse().join('/') : '—'
            const depFR = r.departure_date ? r.departure_date.split('-').reverse().join('/') : '—'
            return `<tr style="background:${i % 2 === 0 ? '#F7F4EF' : '#fff'};">
              <td style="padding:7px 10px;color:#2C2416;">${arrFR}</td>
              <td style="padding:7px 10px;color:#4A3728;">${depFR}</td>
              <td style="padding:7px 10px;color:#2C2416;">${r.guest_name || '—'}</td>
              <td style="padding:7px 10px;text-align:center;color:#4A3728;">${r.nights || '—'}</td>
              <td style="padding:7px 10px;text-align:center;">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${platColor};margin-right:4px;vertical-align:middle;"></span>
                <span style="font-size:0.85em;color:#4A3728;">${platLabel}</span>
              </td>
              <td style="padding:7px 10px;text-align:right;color:#2C2416;">${fmt(r.fin_revenue)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:600;color:#059669;">${v.LOY ? fmt(v.LOY.montant_ht) : '—'}</td>
            </tr>`}).join('')}
        </tbody>
      </table>`
    : '<p style="color:#9C8E7D;font-style:italic;font-size:0.9em;margin:8px 0 0;">Aucune réservation ce mois.</p>'

  const reviewsHTML = reviews.length
    ? reviews.slice(0, 5).map(r => `
      <div style="border-left:3px solid #CC9933;padding:10px 16px;margin-bottom:12px;background:#F7F4EF;border-radius:0 6px 6px 0;">
        <div style="color:#CC9933;font-size:1.1em;margin-bottom:4px;">${'★'.repeat(Math.round(r.rating || 0))}${'☆'.repeat(5 - Math.round(r.rating || 0))}</div>
        <p style="margin:0;color:#2C2416;font-style:italic;line-height:1.6;">«&nbsp;${r.comment?.substring(0, 200) || ''}${(r.comment?.length || 0) > 200 ? '…' : ''}&nbsp;»</p>
      </div>`).join('')
    : '<p style="color:#9C8E7D;font-style:italic;font-size:0.9em;">Aucun avis reçu ce mois.</p>'

  const llmHTML = llmAnalyse
    ? llmAnalyse.split('\n\n').map(p => p.trim()).filter(Boolean)
        .map(p => `<p style="margin:0 0 14px;color:#2C2416;line-height:1.75;font-size:0.95em;">${p.replace(/\n/g, '<br/>')}</p>`).join('')
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
  .section { padding:28px 36px; border-bottom:1px solid #EDEBE5; }
  .section-title { font-size:0.7em; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#CC9933; margin-bottom:16px; }
  .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .kpi { background:#F7F4EF; border:1px solid #EDEBE5; border-radius:8px; padding:14px 12px; text-align:center; }
  .kpi-val { font-size:1.25em; font-weight:700; color:#2C2416; }
  .kpi-lbl { font-size:0.68em; color:#9C8E7D; margin-top:3px; text-transform:uppercase; letter-spacing:0.5px; }
  .kpi-delta { font-size:0.72em; margin-top:2px; }
  .footer { text-align:center; padding:20px 32px; font-size:0.76em; color:#9C8E7D; background:#F7F4EF; border-top:2px solid #CC9933; }
</style>
</head>
<body>
<div class="container">

  <!-- HERO -->
  <div style="position:relative;height:220px;overflow:hidden;">
    <img src="https://destinationcotebasque.com/wp-content/uploads/2026/03/MG_2831-copie-6-1-e1773996205308.jpg"
      style="width:100%;height:100%;object-fit:cover;object-position:center 30%;" onerror="this.style.display='none'"/>
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,14,8,0.45),rgba(20,14,8,0.78));"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 24px;">
      <img src="https://destinationcotebasque.com/wp-content/uploads/2019/08/cropped-cropped-GoDaddyStudioPage-0-2-2-700x363.png"
        style="height:44px;margin-bottom:12px;opacity:0.95;" onerror="this.style.display='none'"/>
      <div style="font-family:'PT Serif',Georgia,serif;color:#CC9933;font-size:0.75em;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;">Rapport mensuel propriétaire</div>
      <div style="font-family:'DM Sans',Arial,sans-serif;color:#fff;font-size:1.4em;font-weight:700;">${bienName}</div>
      <div style="color:#D9CEB8;font-size:0.95em;margin-top:4px;">${moisLabel} · ${proprio?.nom || ''}</div>
    </div>
  </div>

  <!-- SYNTHÈSE FINANCIÈRE -->
  <div class="section" style="background:#2C2416;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#3D3020;">
      <div style="background:#2C2416;padding:18px 16px;text-align:center;">
        <div style="font-size:0.65em;color:#9C8E7D;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Base commissionnable</div>
        <div style="font-size:1.3em;font-weight:700;color:#D9CEB8;">${fmt(kpis.caHeb)}</div>
        ${deltaCA !== null ? `<div style="font-size:0.72em;margin-top:3px;color:${deltaCA >= 0 ? '#4ADE80' : '#F87171'};">${deltaCA >= 0 ? '▲' : '▼'} vs N-1</div>` : ''}
      </div>
      <div style="background:#2C2416;padding:18px 16px;text-align:center;border-left:1px solid #3D3020;border-right:1px solid #3D3020;">
        <div style="font-size:0.65em;color:#9C8E7D;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Honoraires DCB</div>
        <div style="font-size:1.3em;font-weight:700;color:#CC9933;">${fmt(kpis.caHeb - kpis.loyTotal)}</div>
        <div style="font-size:0.7em;color:#6B5E4A;margin-top:3px;">gestion & services</div>
      </div>
      <div style="background:#2C2416;padding:18px 16px;text-align:center;">
        <div style="font-size:0.65em;color:#9C8E7D;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Reversement net</div>
        <div style="font-size:1.3em;font-weight:700;color:#fff;">${fmt(kpis.loyTotal)}</div>
        <div style="font-size:0.7em;color:#6B5E4A;margin-top:3px;">virement propriétaire</div>
      </div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="section">
    <div class="section-title">Indicateurs du mois</div>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-val">${kpis.nbResas}</div>
        <div class="kpi-lbl">Réservations</div>
        ${kpisN1?.nbResas != null ? `<div class="kpi-delta" style="color:${kpis.nbResas >= kpisN1.nbResas ? '#059669' : '#DC2626'};">${kpis.nbResas >= kpisN1.nbResas ? '▲' : '▼'} N-1 : ${kpisN1.nbResas}</div>` : ''}
      </div>
      <div class="kpi">
        <div class="kpi-val">${kpis.tauxOcc}%</div>
        <div class="kpi-lbl">Taux d'occupation</div>
        ${deltaOcc !== null ? `<div class="kpi-delta" style="color:${deltaOcc >= 0 ? '#059669' : '#DC2626'};">${deltaOcc >= 0 ? '▲' : '▼'} ${Math.abs(deltaOcc)} pts</div>` : ''}
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
        <div class="kpi-val">${noteMoisMoy ? '★ ' + noteMoisMoy : '—'}</div>
        <div class="kpi-lbl">Note voyageurs</div>
        ${nbReviewsGlobal > 0 ? `<div class="kpi-delta" style="color:#9C8E7D;">★ ${noteGlobaleMoy} global (${nbReviewsGlobal})</div>` : ''}
      </div>
    </div>
  </div>

  ${llmHTML ? `
  <!-- ANALYSE -->
  <div class="section" style="background:#FDFAF7;">
    <div class="section-title">Analyse du mois</div>
    <div style="border-left:3px solid #CC9933;padding-left:18px;">
      ${llmHTML}
    </div>
  </div>` : ''}

  <!-- RÉSERVATIONS -->
  <div class="section">
    <div class="section-title">Séjours du mois (${(resas || []).length})</div>
    ${resasHTML}
  </div>

  ${reviews.length ? `
  <!-- AVIS -->
  <div class="section">
    <div class="section-title">Avis voyageurs (${reviews.length}${noteMoisMoy ? ' · ★ ' + noteMoisMoy + '/5' : ''})</div>
    ${reviewsHTML}
  </div>` : ''}

  ${noteHTML ? `
  <!-- NOTE MARCHÉ -->
  <div class="section">
    <div class="section-title">Note de marché</div>
    ${noteHTML}
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
