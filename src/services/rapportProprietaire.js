import { supabase } from '../lib/supabase'

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
  const { kpis, resas, reviews, notes } = data
  const [year, monthIdx] = mois.split('-')
  const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const moisLabel = MOIS_FR[parseInt(monthIdx) - 1] + ' ' + year
  const fmt = (centimes) => ((centimes || 0) / 100).toFixed(2).replace('.', ',') + ' €'
  const fmtN = (v) => (v || 0).toLocaleString('fr-FR')

  const reviewsHTML = reviews.length
    ? reviews.map(r => `
      <div style="border-left:3px solid #CC9933;padding:10px 14px;margin-bottom:10px;background:#FDFAF4;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="color:#2C2416;">${r.reviewer_name || 'Voyageur'}</strong>
          <span style="color:#CC9933;font-size:1.2em;">${'★'.repeat(Math.round(r.rating || 0))}${'☆'.repeat(5 - Math.round(r.rating || 0))}</span>
        </div>
        <p style="margin:0;color:#4A3728;font-style:italic;">"${r.comment || ''}"</p>
        <div style="font-size:0.8em;color:#9C8E7D;margin-top:4px;">${r.reservation?.bien?.hospitable_name || ''}</div>
      </div>`).join('')
    : '<p style="color:#9C8E7D;font-style:italic;">Aucun avis reçu ce mois.</p>'

  const notesHTML = notes.length
    ? notes.map(n => n.note ? `
      <div style="margin-bottom:10px;">
        <div style="font-weight:600;color:#CC9933;margin-bottom:4px;">${n.bienName}</div>
        <p style="margin:0;color:#2C2416;line-height:1.6;">${n.note}</p>
      </div>` : '').join('') || '<p style="color:#9C8E7D;font-style:italic;">Aucune note ce mois.</p>'
    : '<p style="color:#9C8E7D;font-style:italic;">Aucune note ce mois.</p>'

  const resasHTML = (resas || []).length
    ? `<table style="width:100%;border-collapse:collapse;font-size:0.9em;">
        <thead>
          <tr style="background:#EAE3D4;color:#2C2416;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #CC9933;">Bien</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #CC9933;">Arrivée</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #CC9933;">Nuits</th>
            <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #CC9933;">CA HEB</th>
          </tr>
        </thead>
        <tbody>
          ${(resas || []).map((r, i) => `
          <tr style="background:${i % 2 === 0 ? '#FDFAF4' : '#F7F3EC'};">
            <td style="padding:7px 10px;color:#2C2416;">${r.bien?.hospitable_name || '—'}</td>
            <td style="padding:7px 10px;color:#4A3728;">${r.arrival_date || '—'}</td>
            <td style="padding:7px 10px;text-align:right;color:#4A3728;">${r.nights || '—'}</td>
            <td style="padding:7px 10px;text-align:right;font-weight:600;color:#2C2416;">${fmt(r.fin_revenue)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p style="color:#9C8E7D;font-style:italic;">Aucune réservation ce mois.</p>'

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rapport mensuel — ${moisLabel}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; background:#F7F3EC; color:#2C2416; }
  .container { max-width:680px; margin:0 auto; padding:0 0 40px; }
  .header { background:#2C2416; padding:28px 32px; text-align:center; }
  .header h1 { color:#CC9933; font-size:1.3em; letter-spacing:2px; text-transform:uppercase; margin-bottom:4px; }
  .header p { color:#D9CEB8; font-size:0.9em; }
  .section { background:#fff; margin:0 0 2px; padding:24px 32px; }
  .section:first-of-type { margin-top:2px; }
  h2 { color:#CC9933; font-size:1em; text-transform:uppercase; letter-spacing:1px; margin-bottom:16px; border-bottom:1px solid #D9CEB8; padding-bottom:8px; }
  .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .kpi { background:#F7F3EC; border:1px solid #D9CEB8; border-radius:8px; padding:14px; text-align:center; }
  .kpi-val { font-size:1.4em; font-weight:700; color:#2C2416; }
  .kpi-lbl { font-size:0.75em; color:#9C8E7D; margin-top:3px; text-transform:uppercase; letter-spacing:0.5px; }
  .footer { text-align:center; padding:20px 32px; font-size:0.78em; color:#9C8E7D; background:#EAE3D4; border-top:2px solid #CC9933; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Destination Côte Basque</h1>
    <p>Rapport mensuel propriétaire — <strong style="color:#D9CEB8;">${moisLabel}</strong></p>
    <p style="margin-top:8px;font-size:1em;color:#D9CEB8;">${proprio.nom}</p>
  </div>

  <div class="section">
    <h2>Indicateurs du mois</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-val">${kpis.nbResas}</div><div class="kpi-lbl">Réservations</div></div>
      <div class="kpi"><div class="kpi-val">${fmt(kpis.caHeb)}</div><div class="kpi-lbl">CA Hébergement</div></div>
      <div class="kpi"><div class="kpi-val">${fmt(kpis.loyTotal)}</div><div class="kpi-lbl">Reversement</div></div>
      <div class="kpi"><div class="kpi-val">${kpis.nuitsOccupees}/${kpis.nuitsDispos}</div><div class="kpi-lbl">Nuits occ./dispo.</div></div>
      <div class="kpi"><div class="kpi-val">${kpis.dureeMoy} nuits</div><div class="kpi-lbl">Durée moyenne</div></div>
      <div class="kpi"><div class="kpi-val">${fmt(kpis.revpar * 100)}</div><div class="kpi-lbl">RevPAR</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Réservations</h2>
    ${resasHTML}
  </div>

  ${reviews.length ? `<div class="section"><h2>Avis voyageurs</h2>${reviewsHTML}</div>` : ''}

  ${notesHTML !== '<p style="color:#9C8E7D;font-style:italic;">Aucune note ce mois.</p>' ? `<div class="section"><h2>Note de marché</h2>${notesHTML}</div>` : ''}

  <div class="footer">
    <p>Destination Côte Basque — Conciergerie de prestige, Biarritz</p>
    <p style="margin-top:4px;">Rapport généré le ${new Date().toLocaleDateString('fr-FR')}</p>
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
