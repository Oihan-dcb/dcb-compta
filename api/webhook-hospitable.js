// api/webhook-hospitable.js — DCB Compta
// POST /api/webhook-hospitable?token=<WEBHOOK_SECRET>
//
// Reçoit reservation.created / reservation.updated depuis Hospitable
// → sync de la seule résa concernée + recalcul de sa ventilation (repli : mois complet)
// → répond 200 après sync (idempotent si Hospitable retry)
//
// Config Hospitable UI : Apps → Webhooks → + Add new
//   URL : https://dcb-compta.vercel.app/api/webhook-hospitable?token=<WEBHOOK_SECRET>
//   Events : reservation.created, reservation.updated

import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET;
const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SELF_URL       = 'https://dcb-compta.vercel.app';

function verifyToken(t) {
  if (!WEBHOOK_SECRET) { console.error('[webhook-hospitable] WEBHOOK_SECRET absent — requête rejetée'); return false; }
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
  const hospId = data?.id || data?.uuid || null;

  // 1. Voie normale (audit I-149, 24/09/2026) : synchro de la SEULE résa concernée puis
  //    recalcul de sa ventilation. Avant : synchro du mois complet pour les 2 agences à chaque
  //    événement (~110s en haute saison, 4351 synchros de mois en 90 jours, 504 constatés).
  if (hospId) {
    try {
      const r = await fetch(`${SELF_URL}/api/sync-reservations?hospitable_id=${encodeURIComponent(hospId)}&token=${WEBHOOK_SECRET}`, { method: 'POST' });
      const d = await r.json();
      if (r.ok && d?.skipped) return res.status(200).json({ ok: true, skipped: d.skipped });
      if (r.ok && d?.reservation_id) {
        console.log(`[webhook-hospitable] ${action} ${d.code} (${d.agence} ${d.mois_comptable}) synchronisée`);
        const v = await fetch(`${SELF_URL}/api/ventiler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WEBHOOK_SECRET}` },
          body: JSON.stringify({ reservation_id: d.reservation_id }),
        }).catch(e => ({ ok: false, statusText: e.message }));
        if (!v.ok) console.error(`[webhook-hospitable] ventilation ${d.code} échouée : ${v.status || ''} ${v.statusText || ''}`);
        return res.status(200).json({ ok: true, mode: 'resa', ...d });
      }
      console.warn(`[webhook-hospitable] synchro unitaire ${hospId} KO (${r.status}) — repli sur le mois`, d?.error);
    } catch (e) {
      console.warn(`[webhook-hospitable] synchro unitaire ${hospId} exception — repli sur le mois:`, e.message);
    }
  }

  // 2. Repli (ancienne voie) : synchro du mois d'arrivée, 2 agences, + ventilation du mois
  if (!arrivalDate) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'no_arrival_date' });
  }
  const mois = arrivalDate.substring(0, 7); // YYYY-MM

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
  if (errors.length) console.error('[webhook-hospitable] erreurs sync:', errors);

  for (const agence of ['dcb', 'lauian']) {
    fetch(`${SUPABASE_URL}/functions/v1/ventilation-auto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ agence, mois }),
    }).then(r => r.json()).then(d => {
      console.log(`[webhook-hospitable] ventilation ${mois} ${agence} → ${d.total} résa(s)`);
    }).catch(e => {
      console.error(`[webhook-hospitable] erreur ventilation ${agence}:`, e.message);
    });
  }

  return res.status(200).json({ ok: true, mode: 'mois', mois, synced: true });
}
