// api/webhook-hospitable.js — DCB Compta
// POST /api/webhook-hospitable?token=<WEBHOOK_SECRET>
//
// Reçoit reservation.created / reservation.updated depuis Hospitable
// → sync immédiat du mois pour dcb + lauian (parallèle)
// → répond 200 après sync (idempotent si Hospitable retry)
//
// Config Hospitable UI : Apps → Webhooks → + Add new
//   URL : https://dcb-compta.vercel.app/api/webhook-hospitable?token=<WEBHOOK_SECRET>
//   Events : reservation.created, reservation.updated

import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET;
const SELF_URL       = 'https://dcb-compta.vercel.app';

function verifyToken(t) {
  if (!WEBHOOK_SECRET) { console.warn('[webhook-hospitable] WEBHOOK_SECRET absent'); return true; }
  if (!t) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(WEBHOOK_SECRET)); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!verifyToken(req.query?.token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { action, data } = req.body || {};
  console.log(`[webhook-hospitable] event: ${action}`);

  if (!['reservation.created', 'reservation.updated'].includes(action)) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'event_ignored' });
  }

  const arrivalDate = data?.arrival_date || data?.start_date;
  if (!arrivalDate) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'no_arrival_date' });
  }
  const mois = arrivalDate.substring(0, 7); // YYYY-MM

  // Sync les deux agences en parallèle avant de répondre
  // (si Hospitable timeout à 30s et retry → upsert idempotent, pas de doublon)
  const results = await Promise.allSettled(
    ['dcb', 'lauian'].map(async agence => {
      const r = await fetch(
        `${SELF_URL}/api/sync-reservations?mois=${mois}&agence=${agence}&token=${WEBHOOK_SECRET}`,
        { method: 'POST' }
      );
      const d = await r.json();
      console.log(`[webhook-hospitable] sync ${mois} ${agence} → créées:${d.created} màj:${d.updated} erreurs:${d.errors}`);
      return d;
    })
  );

  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);
  if (errors.length) console.error('[webhook-hospitable] erreurs:', errors);

  return res.status(200).json({ ok: true, mois, synced: true });
}
