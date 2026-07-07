// api/matching-auto.js — DCB Compta
// GET/POST /api/matching-auto?mois=2026-07
//
// Cron nightly (4h00, après ventilation 3h et sync-payouts 3h30) : lance le matching
// automatique du rapprochement bancaire sur le mois courant ET le mois précédent
// (mouvements du relevé précédent rapprochés tardivement).
//
// ZÉRO duplication : importe directement src/services/rapprochement.js — LA référence
// du moteur de matching (règle CF-C8). Les libs src/lib/supabase.js et src/lib/agence.js
// sont isomorphes : côté serveur elles utilisent process.env + la clé service_role.
// L'agence traitée = VITE_AGENCE du projet Vercel (dcb-compta → dcb, lauian-compta →
// lauian) — chaque projet matche SON agence, comme le front.

import { lancerMatchingAuto, marquerFraisBancairesNonGeres } from '../src/services/rapprochement.js'
import { AGENCE } from '../src/lib/agence.js'

const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET    = process.env.HOSPITABLE_WEBHOOK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET; // envoyé par Vercel en Authorization: Bearer sur les crons
const ALLOWED_EMAILS    = (process.env.ALLOWED_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Auth : webhook secret / CRON_SECRET (cron) OU JWT Supabase admin (UI)
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'HOSPITABLE_WEBHOOK_SECRET non configuré' });

  let source = 'cron';
  const isCronToken = token === WEBHOOK_SECRET || (CRON_SECRET && token === CRON_SECRET);
  if (!isCronToken) {
    if (!SUPABASE_ANON_KEY) return res.status(401).json({ error: 'Non autorisé' });
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!authRes?.ok) return res.status(401).json({ error: 'Non autorisé' });
    if (ALLOWED_EMAILS.length) {
      const { email } = await authRes.json();
      if (!ALLOWED_EMAILS.includes((email || '').toLowerCase())) return res.status(403).json({ error: 'Accès refusé' });
    }
    source = 'manuel';
  }

  const now = new Date();
  const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const moisPrecedent = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const moisList = req.query?.mois ? [req.query.mois] : [moisPrecedent, moisCourant];

  console.log(`[matching-auto] agence=${AGENCE} mois=${moisList.join(',')} source=${source}`);

  const results = {};
  try {
    for (const mois of moisList) {
      // lancerMatchingAuto journalise lui-même dans import_log (badge « Dernier sync »)
      const log = await lancerMatchingAuto(mois, source);
      results[mois] = { matched: log.matched, skipped: log.skipped, errors: log.errors };
      console.log(`[matching-auto] ${mois} ${AGENCE} — ${log.matched} rapprochés, ${log.skipped} ignorés`);
    }

    // Frais bancaires (tenue/cotisation/Stripe) : jamais de résa/facture à lier, on les
    // sort du périmètre "à traiter" plutôt que de les laisser réapparaître chaque mois.
    const { marques } = await marquerFraisBancairesNonGeres(AGENCE);
    if (marques > 0) console.log(`[matching-auto] ${AGENCE} — ${marques} frais bancaire(s) passé(s) non_gere`);

    return res.json({ ok: true, agence: AGENCE, results, fraisBancairesNonGeres: marques });
  } catch (err) {
    console.error('[matching-auto] erreur:', err.message);
    return res.status(500).json({ error: err.message, results });
  }
}
