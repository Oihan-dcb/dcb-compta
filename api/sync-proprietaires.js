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

import { skipDuplicateCron } from './_cronGuard.js';
import { planifierSynchro, emailDepuisClientEvoliz, CHAMPS_SYNC } from '../src/services/proprietaireSyncCore.js';
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

export default async function handler(req, res) {
  if (skipDuplicateCron(req, res)) return; // cf. api/_cronGuard.js — crons exécutés par dcb-compta seulement
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

    // 2-4. Fusion via le noyau partagé (src/services/proprietaireSyncCore.js) : complète les
    // champs vides, ne remplace un champ que s'il a changé chez Evoliz, ne touche jamais
    // actif/agence d'une fiche existante (I-148).
    const actifsEvoliz = allClients.filter(c => c.enabled !== false);
    const existingProps = await sb(`proprietaire?agence=eq.${agence}&select=id,nom,prenom,id_evoliz,email,actif,duplicate_of_id,evoliz_snapshot,${CHAMPS_SYNC.join(',')}`);
    const autres = await sb(`proprietaire?agence=neq.${agence}&id_evoliz=not.is.null&select=id_evoliz`);
    const { inserts, updates, collisions } = planifierSynchro(actifsEvoliz, existingProps || [], new Set((autres || []).map(p => p.id_evoliz)), agence);
    log.collisions = collisions;

    if (inserts.length) {
      await sb('proprietaire', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify(inserts) });
    }
    for (const u of updates) {
      await sb(`proprietaire?id=eq.${u.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(u.patch) })
        .catch(e => { log.errors++; console.warn('sync-proprietaires update error:', e.message); });
    }
    log.created = inserts.length;
    log.updated = updates.length;

    // 4b. Emails manquants (I-148) : listClients ne renvoie pas l'email → getClient sur les fiches
    // actives qui en sont dépourvues (plafonné par run pour rester dans maxDuration).
    const sansEmail = (existingProps || []).filter(p => p.id_evoliz && !p.email && p.actif && !p.duplicate_of_id).slice(0, 25);
    log.emails_completes = 0;
    for (const p of sansEmail) {
      try {
        const resp = await evolizCall('getClient', companyId, { clientId: p.id_evoliz });
        const email = emailDepuisClientEvoliz(resp?.data);
        if (email) {
          await sb(`proprietaire?id=eq.${p.id}&email=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ email }) });
          log.emails_completes++;
        }
      } catch (e) { console.warn('sync-proprietaires getClient:', p.id_evoliz, e.message); }
    }

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
        message: `[cron] Sync proprietaires ${agence} — ${log.created} créés, ${log.updated} mis à jour, ${log.emails_completes} email(s) complété(s)`
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
