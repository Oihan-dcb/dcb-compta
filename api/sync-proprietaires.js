// api/sync-proprietaires.js — DCB Compta
// GET/POST /api/sync-proprietaires?agence=dcb
//
// Version serveur de src/services/syncProprietaires.js — appelable par le cron
// nightly (même pattern d'auth que api/sync-biens.js : token CRON_SECRET/
// HOSPITABLE_WEBHOOK_SECRET, ou session utilisateur autorisée).
//
// Garde-fou anti-doublon (2026-08-05, même incident-type que Villa Bacalan) :
// une fiche proprietaire créée à la main (id_evoliz NULL) qui apparaît ensuite
// comme client réel côté Evoliz arriverait avec un id_evoliz inconnu — sans
// vérification elle serait créée en doublon au lieu de compléter la fiche
// existante. On détecte ce cas par nom normalisé ou email identique à une
// fiche existante de la même agence : pas de création, la collision est
// remontée dans le log pour résolution manuelle (lier l'id_evoliz à la fiche).

const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET    = process.env.HOSPITABLE_WEBHOOK_SECRET;
const CRON_SECRET       = process.env.CRON_SECRET;
const ALLOWED_EMAILS    = (process.env.ALLOWED_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// Mapping agence → companyId Evoliz (cf. supabase/functions/evoliz-proxy/index.ts)
const EVOLIZ_COMPANY_ID = { dcb: '114158', lauian: '115576' };

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

// Appelle l'edge function evoliz-proxy (verify_jwt: true → service role key en bearer)
async function evolizCall(action, companyId, payload = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/evoliz-proxy`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, companyId, payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Evoliz proxy ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function normalizeName(nom, prenom) {
  const s = `${nom || ''} ${prenom || ''}`;
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  // ── Auth : même pattern que sync-biens.js ─────────────────────────────────
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
  const companyId = EVOLIZ_COMPANY_ID[agence];
  if (!companyId) return res.status(400).json({ error: `Agence inconnue: ${agence}` });

  const log = { created: 0, updated: 0, errors: 0, total: 0, collisions: [] };

  try {
    // 1. Récupérer tous les clients Evoliz (pagination)
    let allClients = [];
    let page = 1;
    while (true) {
      const resp = await evolizCall('listClients', companyId, { page });
      const clients = resp?.data?.data;
      if (!Array.isArray(clients) || clients.length === 0) break;
      allClients = allClients.concat(clients);
      const lastPage = resp?.data?.meta?.last_page || 1;
      if (page >= lastPage) break;
      page++;
    }

    if (allClients.length === 0) {
      throw new Error('Aucun client retourné par Evoliz — vérifier les clés API');
    }

    const seen = new Set();
    allClients = allClients.filter(c => {
      if (seen.has(c.clientid)) return false;
      seen.add(c.clientid);
      return true;
    });
    log.total = allClients.length;

    // 2. Mapper vers les lignes proprietaire
    const rows = allClients
      .filter(c => c.enabled !== false)
      .map(c => {
        const name = (c.name || '').trim();
        const parts = name.split(/\s+/);
        let nom = name;
        let prenom = null;

        if (c.type === 'Particulier' && parts.length >= 2) {
          const upperParts = parts.filter(p => p === p.toUpperCase() && p.length > 1);
          const mixedParts = parts.filter(p => p !== p.toUpperCase() || p.length <= 1);
          if (upperParts.length > 0 && mixedParts.length > 0) {
            nom = upperParts.join(' ');
            prenom = mixedParts.join(' ');
          } else {
            nom = parts[parts.length - 1];
            prenom = parts.slice(0, -1).join(' ');
          }
        }

        const addr = c.address || {};
        // Evoliz v1 : mobile, phone directs — mais PAS d'email sur l'objet client
        // (l'email vit dans /clients/{id}/contacts, pas dans listClients). Ne
        // jamais inclure `email` dans les lignes synchronisées ici : ça écraserait
        // à null l'email saisi à la main dans DCB Compta à chaque sync (bug
        // corrigé 2026-08-05).
        const tel = (c.mobile || c.phone || '').trim() || null;

        return {
          id_evoliz: String(c.clientid),
          nom: nom.trim(),
          prenom: prenom?.trim() || null,
          telephone: tel,
          adresse: addr.addr || null,
          code_postal: addr.postcode || null,
          ville: addr.town || null,
          pays: addr.country?.label || 'France',
          actif: true,
          agence,
        };
      });

    // 3. Récupérer les fiches existantes de l'agence pour détecter les collisions
    const existingProps = await sb(`proprietaire?agence=eq.${agence}&select=id,nom,prenom,id_evoliz`);
    const existingByEvolizId = new Map((existingProps || []).filter(p => p.id_evoliz).map(p => [p.id_evoliz, p]));
    const existingByName = new Map((existingProps || []).map(p => [normalizeName(p.nom, p.prenom), p]));

    const existants = rows.filter(r => existingByEvolizId.has(r.id_evoliz));
    const candidatsNouveaux = rows.filter(r => !existingByEvolizId.has(r.id_evoliz));

    const nouveaux = [];
    for (const r of candidatsNouveaux) {
      const match = existingByName.get(normalizeName(r.nom, r.prenom));
      if (match) {
        log.collisions.push({
          nom: r.nom, prenom: r.prenom,
          id_evoliz_nouveau: r.id_evoliz,
          proprietaire_existant_id: match.id,
          proprietaire_existant_nom: `${match.nom} ${match.prenom || ''}`.trim(),
        });
      } else {
        nouveaux.push(r);
      }
    }

    // 4. Insert des nouveaux + update des existants
    if (nouveaux.length) {
      await sb('proprietaire', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(nouveaux) });
    }
    for (const r of existants) {
      await sb(`proprietaire?id_evoliz=eq.${encodeURIComponent(r.id_evoliz)}&agence=eq.${agence}`, {
        method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(r),
      }).catch(e => console.warn('sync-proprietaires update error:', e.message));
    }

    log.created = nouveaux.length;
    log.updated = existants.length;

    // 5. Logger la sync
    await sb('import_log', {
      method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({
        type: 'evoliz_clients',
        agence,
        statut: log.collisions.length ? 'warning' : 'success',
        nb_lignes_traitees: log.total,
        nb_lignes_creees: log.created,
        nb_lignes_mises_a_jour: log.updated,
        message: `[cron] Sync proprietaires ${agence} — ${log.created} créés, ${log.updated} mis à jour`
          + (log.collisions.length ? ` — ⚠ ${log.collisions.length} collision(s) à résoudre manuellement : ${log.collisions.map(c => `${c.nom} ${c.prenom || ''}`.trim()).join(', ')}` : ''),
      }),
    });

    return res.status(200).json({ ok: true, agence, ...log });
  } catch (err) {
    console.error('[sync-proprietaires] erreur:', err.message);
    try {
      await sb('import_log', {
        method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({ type: 'evoliz_clients', agence, statut: 'error', nb_erreurs: 1, message: err.message }),
      });
    } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
};
