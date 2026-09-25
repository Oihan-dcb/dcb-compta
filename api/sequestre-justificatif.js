// api/sequestre-justificatif.js — DCB Compta
// Cron quotidien (05:20, après imports bancaires, ventilation et rapprochements de la nuit) :
// justificatif du séquestre location saisonnière (I-161) — photo du jour dans
// sequestre_justificatif + alerte si l'écart bouge ou si une anomalie nouvelle apparaît.
//   GET /api/sequestre-justificatif            → calcul + enregistrement + alerte
//   GET /api/sequestre-justificatif?dry_run=1  → calcul seul
// Multi-agence (migration 278) : chaque agence ayant une fiche sequestre_compte active. Exécuté une
// seule fois, par le projet dcb-compta (lauian-compta déploie le même vercel.json : ignoré là-bas).
// Écrit aussi le grand livre des mandants (sequestre_ecriture) de l'agence.

import { justifierSequestre } from '../src/services/sequestreJustificatif.js'
import { AGENCE } from '../src/lib/agence.js'
import { supabase } from '../src/lib/supabase.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET
const ALERTE_TO = ['oihan@destinationcotebasque.com']
const SEUIL_VARIATION = 2000 // 20 € : au-delà, l'écart a bougé depuis la veille

const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

function htmlAlerte(j, precedent, nouvelles) {
  const td = 'padding:7px 12px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416'
  const variation = precedent ? j.ecart - precedent.ecart : null
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 14px"><tr><td align="center">
  <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:680px;width:100%">
    <tr><td style="background:#CC9933;padding:20px 24px;color:#fff;text-align:center">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Destination Côte Basque</div>
      <div style="font-size:18px;font-weight:bold;margin-top:6px">Séquestre ${j.agence === 'dcb' ? 'DCB' : j.agence === 'lauian' ? 'Lauïan' : j.agence} — justificatif du ${j.date.split('-').reverse().join('/')}</div></td></tr>
    <tr><td style="padding:16px 24px;font-size:14px;color:#2C2416">
      Solde bancaire <strong>${eur(j.solde_banque.montant)}</strong> · justifié <strong>${eur(j.total_justifie)}</strong> ·
      écart <strong style="color:${Math.abs(j.ecart) > 100 ? '#B91C1C' : '#059669'}">${eur(j.ecart)}</strong>
      ${variation != null ? `<br><span style="font-size:12px;color:#666">Variation depuis le ${String(precedent.date).split('-').reverse().join('/')} : <strong>${variation > 0 ? '+' : ''}${eur(variation)}</strong></span>` : ''}
    </td></tr>
    ${nouvelles.length ? `<tr><td style="padding:4px 24px 6px;font-size:14px;font-weight:bold;color:#B91C1C">Nouvelles anomalies</td></tr>
    <tr><td style="padding:0 14px"><table width="100%" cellpadding="0" cellspacing="0">${nouvelles.map(a => `<tr><td style="${td}">${a.message}</td></tr>`).join('')}</table></td></tr>` : ''}
    <tr><td style="padding:14px 24px 4px;font-size:14px;font-weight:bold;color:#2C2416">Poches</td></tr>
    <tr><td style="padding:0 14px 14px"><table width="100%" cellpadding="0" cellspacing="0">${j.poches.filter(p => p.montant).map(p => `<tr><td style="${td}">${p.label}</td><td style="${td};text-align:right;white-space:nowrap">${eur(p.montant)}</td></tr>`).join('')}</table></td></tr>
    <tr><td style="padding:14px 24px;font-size:11px;color:#9C8E7D;text-align:center;background:#f9f6f0">Détail dans dcb-compta → Séquestre — calcul automatique chaque nuit.</td></tr>
  </table></td></tr></table></body></html>`
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const autorise = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  if (!autorise) return res.status(401).json({ error: 'Non autorisé' })
  if (AGENCE !== 'dcb') return res.status(200).json({ ok: true, skipped: 'execute_par_dcb_compta', agence: AGENCE })

  const dryRun = req.query?.dry_run === '1'
  const { data: comptes } = await supabase.from('sequestre_compte').select('agence').eq('actif', true)
  const agences = req.query?.agence ? [req.query.agence] : (comptes || []).map(c => c.agence)
  const resultats = []
  for (const agence of agences) {
    try { resultats.push(await traiterAgence(agence, dryRun)) }
    catch (err) {
      console.error('[sequestre-justificatif]', agence, err.message)
      await supabase.from('journal_ops').insert({ categorie: 'banque', action: 'sequestre_justificatif', source: 'cron', statut: 'error', message: `${agence} : ${err.message}` }).then(() => {}, () => {})
      resultats.push({ agence, error: err.message })
    }
  }
  return res.status(resultats.some(r => r.error) ? 500 : 200).json({ ok: !resultats.some(r => r.error), resultats })
}

async function traiterAgence(agence, dryRun) {
  {
    const j = await justifierSequestre(agence)
    if (dryRun) return { agence, dry_run: true, ecart: j.ecart, ecart_import: j.ecart_import, a_affecter: j.ecritures.filter(x => x.ayant_droit === 'a_affecter').length }

    const { data: precedent } = await supabase.from('sequestre_justificatif')
      .select('date, ecart, detail').eq('agence', agence).lt('date', j.date).order('date', { ascending: false }).limit(1).maybeSingle()
    const { error } = await supabase.from('sequestre_justificatif').upsert({
      agence, date: j.date, solde_banque: j.solde_banque.montant, solde_maj: j.solde_banque.maj,
      total_justifie: j.total_justifie, ecart: j.ecart, poches: j.poches, par_mois: j.par_mois,
      detail: { ...j.detail, anomalies: j.anomalies, ecart_import: j.ecart_import, banque: j.solde_banque.banque },
    }, { onConflict: 'agence,date' })
    if (error) throw error
    // Grand livre : recalculé intégralement (dérivé du relevé + affectations + alias)
    const { error: eDel } = await supabase.from('sequestre_ecriture').delete().eq('agence', agence)
    if (eDel) throw eDel
    for (let i = 0; i < j.ecritures.length; i += 500) {
      const { error: eIns } = await supabase.from('sequestre_ecriture').insert(j.ecritures.slice(i, i + 500))
      if (eIns) throw eIns
    }

    const clesAvant = new Set((precedent?.detail?.anomalies || []).map(a => a.cle))
    const nouvelles = j.anomalies.filter(a => !clesAvant.has(a.cle))
    const aBouge = precedent && Math.abs(j.ecart - precedent.ecart) > SEUIL_VARIATION
    let alerte = { envoyee: false }
    if (aBouge || nouvelles.length || !precedent) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SRK}` },
        body: JSON.stringify({ to: ALERTE_TO, subject: `Séquestre ${agence === 'dcb' ? 'DCB' : agence === 'lauian' ? 'Lauïan' : agence} : écart ${eur(j.ecart)}${aBouge ? ` (${j.ecart - precedent.ecart > 0 ? '+' : ''}${eur(j.ecart - precedent.ecart)})` : ''}${nouvelles.length ? ` — ${nouvelles.length} nouvelle(s) anomalie(s)` : ''}`, html: htmlAlerte(j, precedent, nouvelles) }),
      })
      alerte = { envoyee: r.ok, nouvelles: nouvelles.length, variation: precedent ? j.ecart - precedent.ecart : null }
    }
    await supabase.from('journal_ops').insert({ categorie: 'banque', action: 'sequestre_justificatif', source: 'cron', statut: Math.abs(j.ecart) > 100 ? 'warning' : 'ok',
      message: `Séquestre ${agence} ${j.date} : solde ${eur(j.solde_banque.montant)}, justifié ${eur(j.total_justifie)}, écart ${eur(j.ecart)}, ${j.anomalies.length} anomalie(s)` })
    return { agence, date: j.date, solde: j.solde_banque.montant, justifie: j.total_justifie, ecart: j.ecart, ecart_import: j.ecart_import, anomalies: j.anomalies.length,
      ecritures: j.ecritures.length, a_affecter: j.ecritures.filter(x => x.ayant_droit === 'a_affecter').length, alerte }
  }
}
