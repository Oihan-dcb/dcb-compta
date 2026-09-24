// api/lld-auto.js — DCB Compta
// Cron nightly (04:30, après l'import bancaire LLD Pennylane de 03:55) : LLD automatique
// (I-159, 24/09/2026) — statuts, loyers attendus du mois (+ rattrapage 2 mois), rapprochement
// bancaire v2, virements propriétaires, brouillons de factures d'honoraires LLD, récap.
//   GET /api/lld-auto               → exécution
//   GET /api/lld-auto?dry_run=1     → simulation (aucune écriture)
//   GET /api/lld-auto?recap=1       → force l'envoi du récap « LLD — à faire » (sinon le lundi)
// L'agence traitée = VITE_AGENCE du projet (dcb-compta → dcb, lauian-compta → lauian), comme
// matching-auto : chaque projet traite SON agence.

import { lancerLLDAuto } from '../src/services/lldAuto.js'
import { AGENCE } from '../src/lib/agence.js'
import { supabase } from '../src/lib/supabase.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOSPITABLE_WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET
const RECAP_TO = ['oihan@destinationcotebasque.com']

const eur = c => ((c || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const nom = e => [e?.prenom, e?.nom].filter(Boolean).join(' ') || '—'
const date = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'

function htmlRecap(agence, af) {
  const td = 'padding:7px 10px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416'
  const bloc = (titre, lignes, rendu, note = '') => !lignes.length ? '' : `
    <tr><td style="padding:18px 24px 4px;font-size:14px;font-weight:bold;color:#2C2416">${titre} (${lignes.length})</td></tr>
    ${note ? `<tr><td style="padding:0 24px 6px;font-size:12px;color:#666">${note}</td></tr>` : ''}
    <tr><td style="padding:0 14px"><table width="100%" cellpadding="0" cellspacing="0">${lignes.map(l => `<tr>${rendu(l).map(c => `<td style="${td}">${c}</td>`).join('')}</tr>`).join('')}</table></td></tr>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 14px"><tr><td align="center">
  <table width="720" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:720px;width:100%">
    <tr><td style="background:#CC9933;padding:20px 24px;color:#fff;text-align:center">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">${agence === 'lauian' ? 'Lauïan Immobilier' : 'Destination Côte Basque'}</div>
      <div style="font-size:18px;font-weight:bold;margin-top:6px">Locations longues — à faire</div></td></tr>
    ${bloc('Loyers en retard', af.loyers_en_retard, l => [`<strong>${nom(l.etudiant)}</strong><br><span style="color:#9C8E7D;font-size:11px">${l.etudiant?.bien?.code || ''}</span>`, l.mois, eur(l.montant_attendu - (l.montant_recu || 0)), `${l.nb_relances || 0} relance(s)`])}
    ${bloc('Paiements à confirmer', af.paiements_a_confirmer, m => [date(m.date_operation), eur(m.credit), (m.libelle || '').slice(0, 60), `→ ${nom(m.suggestion)} ?<br><span style="color:#9C8E7D;font-size:11px">${m.match_raison || ''}</span>`], 'Reconnus avec un doute : un clic dans dcb-compta (LLD → Ce mois-ci) pour confirmer — le payeur est alors mémorisé.')}
    ${bloc('Paiements non reconnus', af.paiements_non_reconnus, m => [date(m.date_operation), eur(m.credit), (m.libelle || '').slice(0, 80)], 'À rattacher à la main une fois : le payeur sera reconnu automatiquement ensuite.')}
    ${bloc('Virements propriétaires à faire (loyer encaissé)', af.virements_proprio_a_faire, v => [nom(v.etudiant?.proprietaire), v.etudiant?.bien?.code || '', v.mois, eur(v.montant)])}
    ${bloc('Cautions à restituer', af.cautions_a_rendre, e => [nom(e), e.bien?.code || '', `sortie ${date(e.sortie)}`, `<strong>avant le ${date(e.limite_restitution)}</strong>`], 'Délai légal : 1 mois après la remise des clés si l\'état des lieux est conforme, 2 mois sinon (au-delà : pénalité de 10 % du loyer par mois).')}
    ${bloc('Cautions attendues non reçues', af.cautions_non_recues, e => [nom(e), e.bien?.code || '', `entrée ${date(e.date_entree)}`, eur(e.caution)])}
    ${bloc('Sorties dans les 45 jours', af.sorties_proches, e => [nom(e), e.bien?.code || '', date(e.date_sortie_reelle || e.date_sortie_prevue), 'état des lieux de sortie à planifier'])}
    ${bloc('Étudiants sans e-mail', af.etudiants_sans_email, e => [nom(e), e.bien?.code || '', 'relances et quittances impossibles'])}
    <tr><td style="padding:16px 24px;font-size:11px;color:#9C8E7D;text-align:center;background:#f9f6f0">Récap automatique du lundi — api/lld-auto</td></tr>
  </table></td></tr></table></body></html>`
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const autorise = (CRON_SECRET && token === CRON_SECRET) || (HOSPITABLE_WEBHOOK_SECRET && token === HOSPITABLE_WEBHOOK_SECRET)
  if (!autorise) return res.status(401).json({ error: 'Non autorisé' })
  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })

  const dryRun = req.query?.dry_run === '1'
  try {
    const out = await lancerLLDAuto(AGENCE, { dryRun })
    const af = out.detail_a_faire
    const total = Object.values(af).reduce((s, v) => s + v.length, 0)
    const lundi = new Date().getUTCDay() === 1
    let recap = { envoye: false }
    if (!dryRun && total && (lundi || req.query?.recap === '1')) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SRK}` },
        body: JSON.stringify({ to: RECAP_TO, subject: `LLD ${AGENCE === 'lauian' ? 'Lauïan' : 'DCB'} — ${total} point(s) à traiter`, html: htmlRecap(AGENCE, af) }),
      })
      recap = { envoye: r.ok }
    }
    await supabase.from('import_log').insert({ type: 'lld_auto', agence: AGENCE, statut: 'success', message: JSON.stringify({ ...out.a_faire, rapprochement: { ...out.rapprochement, decisions: undefined } }).slice(0, 900) })
    const { detail_a_faire, ...resume } = out
    return res.json({ ok: true, ...resume, recap, ...(dryRun ? { decisions: out.rapprochement.decisions } : {}) })
  } catch (err) {
    console.error('[lld-auto] erreur:', err.message)
    await supabase.from('import_log').insert({ type: 'lld_auto', agence: AGENCE, statut: 'error', message: err.message }).catch(() => {})
    return res.status(500).json({ error: err.message })
  }
}
