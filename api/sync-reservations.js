// api/sync-reservations.js — DCB Compta
// POST/GET /api/sync-reservations?mois=2026-06&agence=dcb
//
// Version serveur de src/services/syncReservations.js
// Appelé par le webhook Hospitable et par le cron nightly.
// Sécurisé par WEBHOOK_SECRET dans le query string.

const HOSPITABLE_TOKEN = process.env.HOSPITABLE_TOKEN;
const SUPABASE_URL     = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET   = process.env.HOSPITABLE_WEBHOOK_SECRET;
const ALLOWED_EMAILS   = (process.env.ALLOWED_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const HOSP_BASE        = 'https://public.api.hospitable.com';

// ── Supabase ─────────────────────────────────────────────────────────────────

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

// ── Hospitable API v2 ────────────────────────────────────────────────────────

async function hospFetch(path, params = {}) {
  const url = new URL(`${HOSP_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(`${k}[]`, x));
    else if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${HOSPITABLE_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Hospitable ${res.status}: ${await res.text()}`);
  return res.json();
}

async function hospFetchAll(path, params = {}, pageSize = 50) {
  let page = 1, all = [];
  while (true) {
    const data = await hospFetch(path, { ...params, per_page: pageSize, page });
    const items = data.data || [];
    all = all.concat(items);
    const lastPage = data.meta?.last_page || 1;
    if (page >= lastPage || all.length >= (data.meta?.total || items.length)) break;
    page++;
  }
  return all;
}

// ── Sanitisation ─────────────────────────────────────────────────────────────

// Supprime les null bytes (\x00) qui font fermer la connexion Supabase
function sanitize(obj) {
  if (typeof obj === 'string') return obj.replace(/\x00/g, '');
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitize(v)]));
  }
  return obj;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function parseReservation(resa, bien, mois) {
  const fin   = resa.financials?.host || {};
  const hostServiceFee = (fin.host_fees || []).find(f =>
    f.label?.toLowerCase().includes('host service') || f.label?.toLowerCase().includes('service fee')
  );
  const taxesTotal = (fin.taxes || []).reduce((s, t) => s + (t.amount || 0), 0);
  const moisComptable = resa.arrival_date ? resa.arrival_date.substring(0, 7) : mois;
  const notAccepted = ['not_accepted', 'not accepted', 'declined', 'expired'].includes(
    resa.reservation_status?.current?.category || resa.status
  );

  // Owner stay : fin_revenue = forfait ménage (cleaning fee invité ou fallback fiche bien)
  const isOwnerStay = resa.stay_type === 'owner_stay' ||
    (typeof resa.owner_stay === 'boolean' ? resa.owner_stay : (resa.owner_stay != null && resa.owner_stay !== false));
  const ownerCleaningFee = isOwnerStay
    ? ((resa.financials?.guest?.fees || []).find(f => f.label?.toLowerCase().includes('cleaning'))?.amount
        ?? bien.forfait_menage_proprio
        ?? null)
    : null;

  return {
    hospitable_id:       resa.id,
    bien_id:             bien.id,
    code:                resa.code,
    platform:            resa.platform === 'booking.com' ? 'booking' : resa.platform,
    platform_id:         resa.platform_id,
    arrival_date:        resa.arrival_date?.substring(0, 10),
    departure_date:      resa.departure_date?.substring(0, 10),
    nights:              resa.nights,
    checkin_time:        resa.check_in,
    checkout_time:       resa.check_out,
    guest_name:          [resa.guest?.first_name, resa.guest?.last_name].filter(Boolean).join(' ') || resa.guest_name || null,
    guest_count:         resa.guest_count || resa.guests?.total || null,
    stay_type:           resa.stay_type || 'guest',
    owner_stay:          isOwnerStay,
    reservation_status:  resa.reservation_status,
    final_status:        resa.reservation_status?.current?.category || resa.status || 'accepted',
    fin_accommodation:   isOwnerStay ? ownerCleaningFee : (fin.accommodation?.amount ?? null),
    fin_revenue:         isOwnerStay ? ownerCleaningFee : (notAccepted ? 0 : (fin.revenue?.amount ?? null)),
    fin_host_service_fee: hostServiceFee?.amount ?? null,
    fin_taxes_total:     taxesTotal || null,
    fin_currency:        fin.currency || 'EUR',
    mois_comptable:      moisComptable,
    hospitable_raw:      resa,
  };
}

async function syncFees(reservationId, hostFinancials) {
  await sb(`reservation_fee?reservation_id=eq.${reservationId}`, { method: 'DELETE', prefer: 'return=minimal' });
  const fees = [];
  for (const fee of (hostFinancials.guest_fees || []))
    fees.push({ reservation_id: reservationId, fee_type: 'guest_fee', label: fee.label, category: fee.category, amount: fee.amount, formatted: fee.formatted });
  for (const fee of (hostFinancials.host_fees || []))
    fees.push({ reservation_id: reservationId, fee_type: 'host_fee', label: fee.label, category: fee.category, amount: fee.amount, formatted: fee.formatted });
  for (const tax of (hostFinancials.taxes || []))
    fees.push({ reservation_id: reservationId, fee_type: 'tax', label: tax.label, category: tax.category, amount: tax.amount, formatted: tax.formatted });
  for (const night of (hostFinancials.accommodation_breakdown || []))
    fees.push({ reservation_id: reservationId, fee_type: 'accommodation_night', label: night.label, category: night.category, amount: night.amount, formatted: night.formatted, nuit_date: night.label });
  if (fees.length > 0)
    await sb('reservation_fee', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(fees) }).catch(e => console.error('Erreur fees:', e.message));
}

function findBienByResa(resa, biens) {
  if (resa.platform_id) {
    const b = biens.find(b => b.hospitable_id?.toString() === resa.platform_id?.toString());
    if (b) return b;
  }
  const name = (resa.property_name || resa.listing_name || '').toLowerCase().trim();
  if (name) {
    const b = biens.find(b => b.hospitable_name?.toLowerCase().trim() === name);
    if (b) return b;
    const b2 = biens.find(b => b.hospitable_name && (
      name.includes(b.hospitable_name.toLowerCase().substring(0, 6)) ||
      b.hospitable_name.toLowerCase().includes(name.substring(0, 6))
    ));
    if (b2) return b2;
  }
  return null;
}

// ── Sync principal ───────────────────────────────────────────────────────────

async function syncMois(mois, agence) {
  const log = { created: 0, updated: 0, errors: 0, total: 0, errorDetails: [] };

  const [year, month] = mois.split('-').map(Number);
  const startDate = `${mois}-01`;
  const lastDay   = new Date(year, month, 0).getDate();
  const endDate   = `${mois}-${String(lastDay).padStart(2, '0')}`;

  // 1. Biens actifs
  const biens = await sb(`bien?listed=eq.true&agence=eq.${agence}&select=id,hospitable_id,hospitable_name,proprietaire_id,provision_ae_ref,forfait_dcb_ref,has_ae,agence,gestion_loyer,forfait_menage_proprio`);
  if (!biens?.length) throw new Error('Aucun bien actif trouvé');
  const bienByHospId = new Map(biens.map(b => [b.hospitable_id, b]));

  // 2. Réservations Hospitable en batch de 10 biens
  const BATCH = 10;
  let allResas = [];
  for (let i = 0; i < biens.length; i += BATCH) {
    const batch = biens.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async b => {
      const resas = await hospFetchAll('/v2/reservations', {
        properties: [b.hospitable_id],
        include: 'financials,guest',
        start_date: startDate,
        end_date: endDate,
      });
      resas.forEach(r => { r.property_id = b.hospitable_id; });
      return resas;
    }));
    allResas = allResas.concat(results.flat());
  }

  log.total = allResas.length;

  // 2b. Enrichir les owner stays avec financials.guest (cleaning fee)
  // Le bulk include=financials,guest ne retourne pas financials.guest pour les owner stays
  const ownerStayResas = allResas.filter(r =>
    r.stay_type === 'owner_stay' || (r.owner_stay != null && r.owner_stay !== false)
  );
  if (ownerStayResas.length > 0) {
    const enriched = await Promise.all(
      ownerStayResas.map(r =>
        hospFetch(`/v2/reservations/${r.id}`, { include: 'financials' }).catch(() => null)
      )
    );
    const enrichedMap = new Map(
      enriched.filter(Boolean).map(e => [e.data?.id || e.id, e.data || e])
    );
    allResas = allResas.map(r => {
      const e = enrichedMap.get(r.id);
      if (e?.financials?.guest) return { ...r, financials: { ...r.financials, guest: e.financials.guest } };
      return r;
    });
  }

  // 3. Existants en base
  const existing = await sb(`reservation?mois_comptable=eq.${mois}&select=id,hospitable_id`);
  const existingMap = new Map((existing || []).map(r => [r.hospitable_id, r]));

  // 4. Upsert chaque résa
  for (const resa of allResas) {
    try {
      const bien = bienByHospId.get(resa.property_id) || findBienByResa(resa, biens);
      if (!bien) continue;

      const parsed = parseReservation(resa, bien, mois);
      const upsertBody = sanitize(parsed.guest_name ? parsed : { ...parsed, guest_name: undefined });

      let resaId;
      try {
        const upserted = await sb('reservation?on_conflict=hospitable_id', {
          method: 'POST',
          prefer: 'return=representation,resolution=merge-duplicates',
          body: JSON.stringify(upsertBody),
        });
        resaId = Array.isArray(upserted) ? upserted[0]?.id : upserted?.id;
        if (!resaId) throw new Error('Upsert sans ID retourné');
      } catch (e) {
        throw new Error(`[upsert] ${e.message}`);
      }

      if (resa.financials?.host) {
        try {
          await syncFees(resaId, resa.financials.host);
        } catch (e) {
          console.error(`[sync-reservations] fees ${resa.code}:`, e.message);
        }
      }

      // Payout synthétique Airbnb
      if (resa.platform === 'airbnb' && parsed.fin_revenue && parsed.arrival_date && bien.gestion_loyer !== false) {
        try {
          const payoutId = resa.id + '_airbnb_payout';
          const payouts = await sb('payout_hospitable?on_conflict=hospitable_id', {
            method: 'POST',
            prefer: 'return=representation,resolution=merge-duplicates',
            body: JSON.stringify({
              hospitable_id:    payoutId,
              platform:         'airbnb',
              amount:           parsed.fin_revenue,
              date_payout:      parsed.arrival_date,
              mois_comptable:   parsed.mois_comptable,
              statut_matching:  'en_attente',
            }),
          });
          const ph = Array.isArray(payouts) ? payouts[0] : payouts;
          if (ph?.id) {
            await sb('payout_reservation?on_conflict=payout_id', {
              method: 'POST',
              prefer: 'return=minimal,resolution=ignore-duplicates',
              body: JSON.stringify({ payout_id: ph.id, reservation_id: resaId }),
            }).catch(() => {});
          }
        } catch (e) {
          throw new Error(`[payout_airbnb] ${e.message}`);
        }
      }

      existingMap.has(resa.id) ? log.updated++ : log.created++;
    } catch (err) {
      console.error(`[sync-reservations] ✗ ${resa.code}:`, err.message);
      log.errors++;
      log.errorDetails.push({ code: resa.code || resa.id, message: err.message });
    }
  }

  // 5. Log import
  await sb('import_log', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      type:                  'hospitable_reservations',
      mois_concerne:         mois,
      statut:                log.errors > 0 ? 'partial' : 'success',
      nb_lignes_traitees:    log.total,
      nb_lignes_creees:      log.created,
      nb_lignes_mises_a_jour: log.updated,
      nb_erreurs:            log.errors,
      message:               `[cron] Sync ${mois} ${agence} — ${log.created} créées, ${log.updated} mises à jour, ${log.errors} erreurs`,
    }),
  }).catch(() => {});

  return log;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Auth : webhook secret (cron) OU JWT Supabase (UI)
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'HOSPITABLE_WEBHOOK_SECRET non configuré' });
  }

  if (token !== WEBHOOK_SECRET) {
    // Fallback : vérifier JWT Supabase (appel depuis l'UI)
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

  const agence = req.query?.agence || req.body?.agence || 'dcb';
  const today  = new Date();
  // Par défaut : mois courant. Accepte aussi ?mois=2026-06
  const mois   = req.query?.mois || req.body?.mois
    || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  console.log(`[sync-reservations] mois=${mois} agence=${agence}`);

  try {
    const log = await syncMois(mois, agence);
    console.log(`[sync-reservations] ✓ créées:${log.created} mises à jour:${log.updated} erreurs:${log.errors}`);
    return res.json({ ok: true, mois, agence, ...log });
  } catch (err) {
    console.error('[sync-reservations] erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
