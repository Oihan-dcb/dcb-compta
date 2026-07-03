// api/sync-payouts.js — DCB Compta
// GET/POST /api/sync-payouts?monthsBack=2
//
// Version serveur (cron nightly 3h30) de src/services/syncPayouts.js (bouton « Sync Airbnb »).
// ⚠️ DUPLICATION CONTRÔLÉE : toute modification de la logique métier (payouts réels,
// résolutions/ajustements, payouts fractionnés) doit être répercutée dans
// src/services/syncPayouts.js — et vice-versa.
//
// Différences assumées avec la version client :
// - couvre les DEUX agences en un run (filtre IBAN par agence : DCB •6555, Lauian •4240)
// - `include=transactions` sur la liste des payouts (pas d'appel détail par payout)
// - lectures/écritures Supabase en batch (limites de durée serverless)
//
// Ce qui est stocké :
// - une ligne synthétique par résa (hospitable_id = {resa_id}_airbnb_payout, amount = part résa)
// - un payout RÉEL (hospitable_id = uuid payout, amount = total viré, reference = détail)
//   quand le payout contient des résolutions/ajustements ou est fractionné
// - payout_reservation.amount_cents = part de chaque résa dans CE payout

const HOSPITABLE_TOKEN  = process.env.HOSPITABLE_TOKEN;
const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET    = process.env.HOSPITABLE_WEBHOOK_SECRET;
const ALLOWED_EMAILS    = (process.env.ALLOWED_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const HOSP_BASE         = 'https://public.api.hospitable.com';
// Suffixes IBAN des comptes bancaires agence recevant les payouts Airbnb
const AIRBNB_IBANS      = (process.env.AIRBNB_IBAN_SUFFIXES || '6555,4240').split(',').map(s => s.trim()).filter(Boolean);

// ── Supabase (REST, service role) ────────────────────────────────────────────

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function sbIn(table, column, values, select) {
  // Lecture par lots (limite de longueur d'URL PostgREST)
  const out = [];
  for (let i = 0; i < values.length; i += 100) {
    const batch = values.slice(i, i + 100).map(v => `"${v}"`).join(',');
    const rows = await sb(`${table}?${column}=in.(${batch})&select=${select}`);
    out.push(...(rows || []));
  }
  return out;
}

// ── Hospitable ───────────────────────────────────────────────────────────────

async function hospFetch(path, params = {}) {
  const url = new URL(`${HOSP_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${HOSPITABLE_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Hospitable ${res.status}: ${await res.text()}`);
  return res.json();
}

// Code de confirmation = dernier mot du champ details ("Apr 7 – 12, 2026 HMXXXXXXXX")
function parseCode(details) {
  if (!details) return null;
  const parts = details.trim().split(/\s+/);
  const code = parts[parts.length - 1];
  return code && /^[A-Z0-9-]{5,}$/.test(code) ? code : null;
}

const fmtE = (c) => ((c || 0) / 100).toFixed(2) + '€';

// ── Sync ─────────────────────────────────────────────────────────────────────

async function syncPayouts(monthsBack = 2) {
  const log = { processed: 0, created: 0, updated: 0, skipped: 0, not_found: 0, real_created: 0, errors: 0, details: [] };

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // 1. Collecter les payouts Airbnb agence dans la fenêtre (liste paginée, du plus récent
  //    au plus ancien — l'API rend les plus anciens en premier, on part de la dernière page)
  const probe = await hospFetch('/v2/payouts', { page: 1, per_page: 100 });
  const lastPage = probe.meta?.last_page || 1;

  const payouts = [];
  let done = false;
  for (let p = lastPage; p >= 1 && !done; p--) {
    const response = await hospFetch('/v2/payouts', { page: p, per_page: 100, include: 'transactions' });
    for (const payout of (response.data || []).slice().reverse()) {
      const payoutDate = payout.date?.slice(0, 10);
      if (!payoutDate || payoutDate < cutoffStr) { done = true; break; }
      if (payout.platform?.toLowerCase() !== 'airbnb') continue;
      if (!AIRBNB_IBANS.some(s => payout.bank_account?.includes(s))) continue;
      payouts.push({ ...payout, _date: payoutDate });
    }
  }

  // 2. Décomposer les transactions + résoudre les résas en batch
  const parsed = payouts.map(payout => {
    const allTxs = payout.transactions?.data || payout.transactions || [];
    return {
      payout,
      resaTxs:   allTxs.filter(t => t.type === 'Reservation'),
      autresTxs: allTxs.filter(t => !['Reservation', 'Payout'].includes(t.type)),
    };
  });

  const codes = [...new Set(parsed.flatMap(p => p.resaTxs.map(t => parseCode(t.details)).filter(Boolean)))];
  const resas = await sbIn('reservation', 'code', codes, 'id,code,fin_revenue');
  const resaByCode = Object.fromEntries(resas.map(r => [r.code, r]));

  const synthIds = resas.map(r => r.id + '_airbnb_payout');
  const realIds  = parsed.map(p => p.payout.id);
  const existing = await sbIn('payout_hospitable', 'hospitable_id', [...synthIds, ...realIds], 'id,hospitable_id,mouvement_id,amount');
  const existingByHospId = Object.fromEntries(existing.map(e => [e.hospitable_id, e]));

  // 3. Construire les écritures
  const synthInserts = [], realInserts = [], prLinks = [];
  const seenSynth = new Set();

  for (const { payout, resaTxs, autresTxs } of parsed) {
    const payoutDate = payout._date;
    let needsRealRow = autresTxs.length > 0;
    const resasDuPayout = [];

    for (const tx of resaTxs) {
      log.processed++;
      const code = parseCode(tx.details);
      const resa = code ? resaByCode[code] : null;
      if (!resa) { log.not_found++; continue; }
      resasDuPayout.push({ resa, txAmount: tx.amount?.amount ?? null });

      const hospId = resa.id + '_airbnb_payout';
      const ex = existingByHospId[hospId];
      // Payout fractionné : la ligne synthétique porte déjà un autre montant
      if (ex && ex.amount != null && tx.amount?.amount != null && ex.amount !== tx.amount.amount) needsRealRow = true;

      if (!ex && !seenSynth.has(hospId)) {
        seenSynth.add(hospId);
        synthInserts.push({
          hospitable_id: hospId, platform: 'airbnb', date_payout: payoutDate,
          amount: tx.amount?.amount ?? resa.fin_revenue ?? null,
          mois_comptable: payoutDate.slice(0, 7), statut_matching: 'en_attente',
          _resa_id: resa.id,
        });
      } else if (ex && !ex.mouvement_id) {
        // Mise à jour de la date (payout re-daté) — unitaire mais rare
        try {
          await sb(`payout_hospitable?id=eq.${ex.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ date_payout: payoutDate }) });
          log.updated++;
        } catch (e) { log.errors++; log.details.push(`update ${code}: ${e.message}`); }
      } else if (ex) {
        log.skipped++;
      }
    }

    // Payout réel (résolutions / ajustements / fractionné)
    if (needsRealRow && !existingByHospId[payout.id]) {
      const reference = (autresTxs.length
        ? autresTxs.map(t => `${t.type}: ${t.details} (${fmtE(t.amount?.amount)})`).join(' | ')
        : 'Payout fractionné : ' + resaTxs.map(t => parseCode(t.details)).filter(Boolean).join(', ')
      ).slice(0, 500);
      realInserts.push({
        hospitable_id: payout.id, platform: 'airbnb', date_payout: payoutDate,
        amount: payout.amount?.amount ?? null,
        mois_comptable: payoutDate.slice(0, 7), statut_matching: 'en_attente', reference,
        _links: resasDuPayout.map(({ resa, txAmount }) => ({ reservation_id: resa.id, amount_cents: txAmount })),
      });
      log.details.push(`Payout réel ${payoutDate} ${fmtE(payout.amount?.amount)} (${reference.slice(0, 90)})`);
    }
  }

  // 4. Écritures en batch
  if (synthInserts.length) {
    const rows = synthInserts.map(({ _resa_id, ...r }) => r);
    const inserted = await sb('payout_hospitable', { method: 'POST', body: JSON.stringify(rows) });
    log.created += inserted?.length || 0;
    const idByHosp = Object.fromEntries((inserted || []).map(r => [r.hospitable_id, r.id]));
    for (const s of synthInserts) {
      const pid = idByHosp[s.hospitable_id];
      if (pid) prLinks.push({ payout_id: pid, reservation_id: s._resa_id, amount_cents: s.amount });
    }
  }
  if (realInserts.length) {
    const rows = realInserts.map(({ _links, ...r }) => r);
    const inserted = await sb('payout_hospitable', { method: 'POST', body: JSON.stringify(rows) });
    log.real_created += inserted?.length || 0;
    const idByHosp = Object.fromEntries((inserted || []).map(r => [r.hospitable_id, r.id]));
    for (const r of realInserts) {
      const pid = idByHosp[r.hospitable_id];
      if (pid) for (const l of r._links) prLinks.push({ payout_id: pid, ...l });
    }
  }
  if (prLinks.length) {
    for (let i = 0; i < prLinks.length; i += 200) {
      await sb('payout_reservation?on_conflict=payout_id,reservation_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify(prLinks.slice(i, i + 200)),
      });
    }
  }

  return log;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Auth : webhook secret (cron) OU JWT Supabase admin (UI) — même schéma que sync-reservations
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'HOSPITABLE_WEBHOOK_SECRET non configuré' });

  if (token !== WEBHOOK_SECRET) {
    if (!SUPABASE_ANON_KEY) return res.status(401).json({ error: 'Non autorisé' });
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!authRes?.ok) return res.status(401).json({ error: 'Non autorisé' });
    if (ALLOWED_EMAILS.length) {
      const { email } = await authRes.json();
      if (!ALLOWED_EMAILS.includes((email || '').toLowerCase())) return res.status(403).json({ error: 'Accès refusé' });
    }
  }

  const monthsBack = Math.min(12, Math.max(1, parseInt(req.query?.monthsBack || req.body?.monthsBack || '2', 10) || 2));
  console.log(`[sync-payouts] monthsBack=${monthsBack}`);

  try {
    const log = await syncPayouts(monthsBack);
    console.log(`[sync-payouts] ✓ traités:${log.processed} créés:${log.created} réels:${log.real_created} maj:${log.updated} introuvables:${log.not_found} erreurs:${log.errors}`);
    return res.json({ ok: true, ...log });
  } catch (err) {
    console.error('[sync-payouts] erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
