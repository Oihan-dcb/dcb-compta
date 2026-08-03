// api/sync-biens.js — DCB Compta
// GET/POST /api/sync-biens?agence=dcb
//
// Version serveur de src/services/syncBiens.js — appelable par le cron nightly
// (même pattern d'auth que api/sync-reservations.js : token CRON_SECRET/
// HOSPITABLE_WEBHOOK_SECRET, ou session utilisateur autorisée).
//
// Garde-fou anti-doublon (incident Villa Bacalan, 2026-08-03) : un bien suivi
// manuellement (hospitable_id placeholder "manual-..."/"MANUAL-...") qui se
// connecte réellement à Hospitable arrive avec un NOUVEL hospitable_id — sans
// vérification, il serait créé en doublon (fiche vide, sans propriétaire) au
// lieu de mettre à jour la fiche existante. On détecte ce cas par nom
// normalisé identique à un bien déjà existant : pas de création, la collision
// est remontée dans le log pour résolution manuelle.

const HOSPITABLE_TOKEN = process.env.HOSPITABLE_TOKEN;
const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET    = process.env.HOSPITABLE_WEBHOOK_SECRET;
const CRON_SECRET       = process.env.CRON_SECRET;
const ALLOWED_EMAILS    = (process.env.ALLOWED_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const HOSP_BASE         = 'https://public.api.hospitable.com';

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

async function hospFetchAll(path, params = {}, pageSize = 50) {
  let page = 1, all = [];
  while (true) {
    const url = new URL(`${HOSP_BASE}${path}`);
    Object.entries({ ...params, per_page: pageSize, page }).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${HOSPITABLE_TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Hospitable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const items = data.data || [];
    all = all.concat(items);
    const lastPage = data.meta?.last_page || 1;
    if (page >= lastPage || all.length >= (data.meta?.total || items.length)) break;
    page++;
  }
  return all;
}

function normalizeName(s) {
  if (!s) return '';
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCode(name) {
  if (!name) return null;
  const numMatch = name.match(/^(\d+)/);
  if (numMatch) return numMatch[1];
  const words = name.split(/[\s\-–_"«»]+/);
  const firstMeaningful = words.find(w => w.length > 2) || words[0];
  return firstMeaningful?.toUpperCase() || null;
}

module.exports = async (req, res) => {
  // ── Auth : même pattern que sync-reservations.js ──────────────────────────
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'HOSPITABLE_WEBHOOK_SECRET non configuré' });
  const isCronToken = token === WEBHOOK_SECRET || (CRON_SECRET && token === CRON_SECRET);
  if (!isCronToken) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return res.status(401).json({ error: 'Non authentifié' });
      const user = await r.json();
      if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes((user.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Accès refusé' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
  }

  const agence = req.query?.agence || req.body?.agence || 'dcb';
  const log = { created: 0, updated: 0, errors: 0, total: 0, collisions: [] };

  try {
    const properties = await hospFetchAll('/v2/properties');
    log.total = properties.length;

    const existingBiens = await sb(`bien?agence=eq.${agence}&select=id,code,hospitable_name,hospitable_id,listed`);
    const existingMap = new Map((existingBiens || []).map(b => [b.hospitable_id, b]));
    const existingByName = new Map((existingBiens || []).map(b => [normalizeName(b.hospitable_name), b]));

    const toUpsert = properties.map(prop => ({
      hospitable_id: prop.id,
      hospitable_name: prop.name || prop.public_name,
      code: extractCode(prop.name),
      adresse: prop.address?.display,
      ville: prop.address?.city,
      timezone: prop.timezone,
      currency: prop.currency || 'EUR',
      listed: prop.listed !== false,
      photo_url: prop.picture?.replace('?aki_policy=small', '?aki_policy=large') || null,
      derniere_sync: new Date().toISOString(),
    }));

    const candidatsNouveaux = toUpsert.filter(p => !existingMap.has(p.hospitable_id));
    const existants = toUpsert.filter(p => existingMap.has(p.hospitable_id));

    const nouveaux = [];
    for (const p of candidatsNouveaux) {
      const match = existingByName.get(normalizeName(p.hospitable_name));
      if (match) {
        log.collisions.push({
          hospitable_name: p.hospitable_name,
          hospitable_id_nouveau: p.hospitable_id,
          bien_existant_id: match.id,
          bien_existant_code: match.code,
          bien_existant_hospitable_id: match.hospitable_id,
        });
      } else {
        nouveaux.push(p);
      }
    }

    if (nouveaux.length) {
      await sb('bien', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify(nouveaux.map(p => ({ ...p, gestion_loyer: true, agence }))),
      });
    }

    for (const p of existants) {
      const { code: _code, ...pSansCode } = p;
      await sb(`bien?hospitable_id=eq.${encodeURIComponent(p.hospitable_id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(pSansCode),
      }).catch(e => console.warn('sync-biens update error:', e.message));
    }

    const collisionIds = new Set(log.collisions.map(c => c.hospitable_id_nouveau));
    for (const prop of properties) {
      if (collisionIds.has(prop.id)) continue;
      if (existingMap.has(prop.id)) log.updated++; else log.created++;
    }

    await sb('import_log', {
      method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({
        type: 'hospitable_properties',
        agence,
        statut: log.collisions.length ? 'warning' : 'success',
        nb_lignes_traitees: log.total,
        nb_lignes_creees: log.created,
        nb_lignes_mises_a_jour: log.updated,
        message: `[cron] Sync biens ${agence} — ${log.created} créés, ${log.updated} mis à jour`
          + (log.collisions.length ? ` — ⚠ ${log.collisions.length} collision(s) à résoudre manuellement : ${log.collisions.map(c => c.hospitable_name).join(', ')}` : ''),
      }),
    });

    return res.status(200).json({ ok: true, agence, ...log });
  } catch (err) {
    console.error('[sync-biens] erreur:', err.message);
    try {
      await sb('import_log', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({ type: 'hospitable_properties', agence, statut: 'error', nb_erreurs: 1, message: err.message }),
      });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
};
