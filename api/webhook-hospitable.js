// api/webhook-hospitable.js — DCB Compta
// POST /api/webhook-hospitable?token=<WEBHOOK_SECRET>
//
// Reçoit reservation.created depuis Hospitable
// → déclenche sync du mois de la réservation
//
// Config Hospitable UI : Apps → Webhooks → + Add new
//   URL : https://dcb-compta.vercel.app/api/webhook-hospitable?token=<WEBHOOK_SECRET>
//   Events : reservation.created, reservation.updated

const crypto        = require('crypto');
const WEBHOOK_SECRET = process.env.HOSPITABLE_WEBHOOK_SECRET;
const SELF_URL       = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://dcb-compta.vercel.app';

function verifyToken(t) {
  if (!WEBHOOK_SECRET) { console.warn('[webhook-hospitable] WEBHOOK_SECRET absent'); return true; }
  if (!t) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(WEBHOOK_SECRET)); }
  catch { return false; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  if (!verifyToken(req.query?.token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { action, data } = req.body || {};
  console.log(`[webhook-hospitable] event: ${action}`);

  if (!['reservation.created', 'reservation.updated'].includes(action)) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'event_ignored' });
  }

  const resa = data || {};
  // Extraire le mois de la date d'arrivée
  const arrivalDate = resa.arrival_date || resa.start_date;
  if (!arrivalDate) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'no_arrival_date' });
  }
  const mois = arrivalDate.substring(0, 7); // YYYY-MM

  // Détecter l'agence depuis hospitable_id de la propriété
  const hospPropertyId = resa.property?.id || resa.property_id || '';
  // On sync les deux agences — le endpoint filtre par bien actif de chaque agence
  const agences = ['dcb', 'lauian'];

  // Répondre immédiatement
  res.status(200).json({ ok: true, processing: true, mois });

  // Déclencher le sync pour chaque agence
  for (const agence of agences) {
    try {
      const r = await fetch(`${SELF_URL}/api/sync-reservations?mois=${mois}&agence=${agence}&token=${WEBHOOK_SECRET}`, {
        method: 'POST',
      });
      const d = await r.json();
      console.log(`[webhook-hospitable] sync ${mois} ${agence} → créées:${d.created} màj:${d.updated} erreurs:${d.errors}`);
    } catch (err) {
      console.error(`[webhook-hospitable] erreur sync ${agence}:`, err.message);
    }
  }
};
