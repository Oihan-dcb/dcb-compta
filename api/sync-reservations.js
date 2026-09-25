// api/sync-reservations.js — DCB Compta
// POST/GET /api/sync-reservations?mois=2026-06&agence=dcb
//
// Version serveur de src/services/syncReservations.js
// Appelé par le webhook Hospitable et par le cron nightly.
// Sécurisé par WEBHOOK_SECRET dans le query string.

import { skipDuplicateCron } from './_cronGuard.js';
import { STATUTS_NON_VENTILABLES } from '../src/lib/constants.js';
const HOSPITABLE_TOKEN = process.env.HOSPITABLE_TOKEN;
const SUPABASE_URL     = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEBHOOK_SECRET   = process.env.HOSPITABLE_WEBHOOK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET; // envoyé par Vercel en Authorization: Bearer sur les crons
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
  // reservation_status.current ne se résume pas à `category` : un statut 'checkpoint' peut
  // porter un sub_category ('voided') qui change tout — Hospitable annule la résa faute de
  // vérification d'identité voyageur dans les délais. Ne garder que `category` seul jetait
  // cette information (bug trouvé le 06/09/2026, résa Maya/HMZATQK95E restée 'checkpoint'
  // en base 6 jours après son annulation réelle, toujours ventilée comme un vrai revenu).
  const statutCourant = resa.reservation_status?.current;
  const statutCombine = statutCourant
    ? (statutCourant.sub_category && statutCourant.sub_category !== statutCourant.category
        ? `${statutCourant.category} ${statutCourant.sub_category}`
        : statutCourant.category)
    : resa.status;
  // Liste locale à ce fichier (pas lib/constants.js — sémantique différente : ici on force
  // fin_revenue=0, alors que STATUTS_NON_VENTILABLES inclut aussi 'cancelled' (traité à part
  // via isCancelled) et 'checkpoint'/'request' (statuts EN ATTENTE, pas encore refusés — ne
  // pas mettre fin_revenue à 0 tant que ce n'est pas tranché). Mêmes statuts composés
  // category+sub_category que STATUTS_NON_VENTILABLES (cf. commentaire ligne 84-88) — trouvé
  // le 07/09/2026 : 4 résas Egin déclinées ('not accepted declined') gardaient un fin_revenue
  // non nul, donc apparaissaient indéfiniment comme "virement non rapproché" (rien n'arrivera
  // jamais en banque pour une demande jamais acceptée).
  const notAccepted = ['not_accepted', 'not accepted', 'not accepted declined', 'not accepted expired', 'declined', 'expired', 'checkpoint voided'].includes(statutCombine);
  const isCancelled = statutCombine === 'cancelled';

  // Annulation directe remboursement total : Hospitable renvoie revenue = sum(host_fees)
  // (la "commission Hospitable" remboursée virtuellement) → DCB n'a rien perçu → fin_revenue = 0
  const platform = resa.platform === 'booking.com' ? 'booking' : resa.platform;
  const hostFeesTotal = (fin.host_fees || []).reduce((s, f) => s + Math.abs(f.amount || 0), 0);
  const isFullRefundDirect = platform === 'direct' && isCancelled
    && fin.revenue?.amount != null && fin.revenue.amount > 0
    && fin.revenue.amount === hostFeesTotal;

  // Réservation MANUELLE annulée : Hospitable garde le prix total en revenue (il ne remet jamais
  // une manuelle à zéro). Sans paiement enregistré, c'est une annulation sans frais → 0.
  // Cas Y6MOIX (SUZETTE 02-09/08/2026, annulée le 15/06, 2 935 € jamais perçus) : restait
  // « annulée avec revenu », donc comptée comme encaissement manquant. Un paiement arrivé
  // quand même en banque est signalé par le justificatif (paiement sur résa annulée sans revenu).
  const isManualCancelSansPaiement = platform === 'manual' && isCancelled
    && !((resa.financials?.guest?.payments || []).some(p => (p.amount || 0) > 0));

  // Bug agrégat Hospitable (constaté 03/07/2026, résa HMQR9Q5ASN) : quand host.adjustments
  // existe (résolutions Airbnb), leur champ revenue compte l'ajustement DEUX FOIS
  // (1160,76 + 2×75 = 1310,76 alors que le ledger ne porte qu'une résolution de 75 €).
  // → on recompose depuis les composantes : accommodation + guest_fees + host_fees
  //   + discounts + adjustments.
  const hostAdjustments = fin.adjustments || [];
  let revenueFiable = fin.revenue?.amount ?? null;
  if (platform === 'airbnb' && hostAdjustments.length > 0 && revenueFiable != null) {
    const recompose = (fin.accommodation?.amount || 0)
      + (fin.guest_fees || []).reduce((s, x) => s + (x.amount || 0), 0)
      + (fin.host_fees || []).reduce((s, x) => s + (x.amount || 0), 0)
      + (fin.discounts || []).reduce((s, x) => s + (x.amount || 0), 0)
      + hostAdjustments.reduce((s, x) => s + (x.amount || 0), 0);
    if (recompose !== revenueFiable) revenueFiable = recompose;
  }

  // Owner stay : fin_revenue = forfait ménage (cleaning fee invité ou fallback fiche bien)
  const isOwnerStay = resa.stay_type === 'owner_stay' ||
    (typeof resa.owner_stay === 'boolean' ? resa.owner_stay : (resa.owner_stay != null && resa.owner_stay !== false));
  // Séjour propriétaire annulé AVANT l'arrivée prévue : annulation sans frais, pas de forfait
  // ménage (règle Oïhan, 24/09/2026). Annulé à l'arrivée ou après : forfait conservé (le ménage
  // a pu être fait). Heure d'annulation = dernier passage 'cancelled' de l'historique Hospitable ;
  // introuvable → comportement inchangé (forfait facturé), jamais de supposition.
  const annuleLe = isCancelled
    ? [...(resa.reservation_status?.history || [])].reverse().find(h => h.category === 'cancelled')?.changed_at
    : null;
  const annuleAvantArrivee = !!(isOwnerStay && annuleLe && resa.check_in && new Date(annuleLe) < new Date(resa.check_in));
  const ownerCleaningFee = isOwnerStay
    ? (annuleAvantArrivee ? 0 : ((resa.financials?.guest?.fees || []).find(f => f.label?.toLowerCase().includes('cleaning'))?.amount
        ?? bien.forfait_menage_proprio
        ?? null))
    : null;

  return {
    hospitable_id:       resa.id,
    bien_id:             bien.id,
    code:                resa.code,
    platform:            platform,
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
    final_status:        statutCombine || 'accepted',
    fin_accommodation:   isOwnerStay ? ownerCleaningFee : (fin.accommodation?.amount ?? null),
    fin_revenue:         isOwnerStay ? ownerCleaningFee : (notAccepted || isFullRefundDirect || isManualCancelSansPaiement ? 0 : revenueFiable),
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

// Écrit UNE résa Hospitable (réservation + fees + payout synthétique Airbnb). Partagé par la
// synchro du mois (syncMois) et la synchro unitaire du webhook (syncUneResa) — même logique.
async function ecrireResa(resa, bien, mois) {
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

  // Ajustements Hospitable (résolutions, AirCover, remboursements) détectés ICI, à chaque
  // synchro — plus seulement pendant la ventilation : un ajustement arrivé après verrouillage du
  // mois ou sur une résa non ventilée n'était jamais vu (6/31 en 2026, dont BACALAN +250€
  // AirCover, audit I-151). Même insertion que _detecterAjustements (api/ventiler.js) : nouveau =
  // 'a_qualifier', jamais d'écrasement d'une qualification (contrainte unique + ignore).
  // Annulée à 0 € : rien à répartir, pas de ligne (sinon rapports bloqués « à trancher »).
  const ajustements = (resa.financials?.host?.adjustments || []).filter(a => (a.amount || 0) !== 0);
  const annuleeSansRevenu = STATUTS_NON_VENTILABLES.includes(parsed.final_status) && !parsed.fin_revenue;
  if (ajustements.length && !annuleeSansRevenu) {
    await sb('reservation_ajustement?on_conflict=reservation_id,label,montant', {
      method: 'POST', prefer: 'return=minimal,resolution=ignore-duplicates',
      body: JSON.stringify(ajustements.map(a => ({ reservation_id: resaId, mois_comptable: parsed.mois_comptable, montant: a.amount, label: a.label || null }))),
    }).catch(e => console.error(`[sync-reservations] ajustements ${resa.code}:`, e.message));
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
      const payoutId = resaId + '_airbnb_payout';
      const payouts = await sb('payout_hospitable?on_conflict=hospitable_id', {
        method: 'POST',
        prefer: 'return=representation,resolution=merge-duplicates',
        body: JSON.stringify({
          hospitable_id:    payoutId,
          platform:         'airbnb',
          amount:           parsed.fin_revenue,
          date_payout:      parsed.arrival_date,
          mois_comptable:   parsed.mois_comptable,
          // PAS de statut_matching ici : l'upsert merge-duplicates le réécrivait à
          // 'en_attente' chaque nuit, y compris pour les payouts déjà rapprochés (438
          // lignes avec mouvement_id mais statut 'en_attente' au 24/09/2026). À la
          // création, le défaut de colonne vaut déjà 'en_attente' (audit I-149).
        }),
      });
      const ph = Array.isArray(payouts) ? payouts[0] : payouts;
      if (ph?.id) {
        await sb('payout_reservation?on_conflict=payout_id,reservation_id', {
          method: 'POST',
          prefer: 'return=minimal,resolution=ignore-duplicates',
          body: JSON.stringify({ payout_id: ph.id, reservation_id: resaId }),
        }).catch(() => {});
      }
    } catch (e) {
      throw new Error(`[payout_airbnb] ${e.message}`);
    }
  }

  return resaId;
}


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
      await ecrireResa(resa, bien, mois);
      existingMap.has(resa.id) ? log.updated++ : log.created++;
    } catch (err) {
      console.error(`[sync-reservations] ✗ ${resa.code}:`, err.message);
      log.errors++;
      log.errorDetails.push({ code: resa.code || resa.id, message: err.message });
    }
  }

  // 4b. Résas en base absentes de la réponse Hospitable → confirmées une par une (404)
  log.deleted = 0;
  try {
    const biensIds = new Set(biens.map(b => b.id));
    const vus = new Set(allResas.map(r => r.id));
    const enBase = await sb(`reservation?mois_comptable=eq.${mois}&final_status=neq.deleted&select=id,hospitable_id,code,bien_id,mois_comptable,fin_revenue,final_status,arrival_date`);
    const absentes = (enBase || []).filter(r => r.hospitable_id && biensIds.has(r.bien_id) && !vus.has(r.hospitable_id));
    if (absentes.length > SEUIL_SUPPRESSIONS_PAR_MOIS) {
      // Garde-fou : une absence massive = réponse API incomplète, pas des suppressions
      log.errorDetails.push({ code: 'suppressions', message: `${absentes.length} résas absentes de Hospitable pour ${mois} — au-delà du seuil (${SEUIL_SUPPRESSIONS_PAR_MOIS}), aucune marquée` });
    } else {
      for (const row of absentes) {
        if (!(await est404(row.hospitable_id))) continue;
        if (await sejourReel(row)) { await signalerSejourReel404(row); continue; }
        await marquerSupprimee(row); log.deleted++;
      }
    }
  } catch (e) {
    log.errorDetails.push({ code: 'suppressions', message: e.message });
  }

  // 5. Log import
  await sb('import_log', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      type:                  'hospitable_reservations',
      agence,
      mois_concerne:         mois,
      statut:                log.errors > 0 ? 'partial' : 'success',
      nb_lignes_traitees:    log.total,
      nb_lignes_creees:      log.created,
      nb_lignes_mises_a_jour: log.updated,
      nb_erreurs:            log.errors,
      message:               `[cron] Sync ${mois} ${agence} — ${log.created} créées, ${log.updated} mises à jour, ${log.errors} erreurs${log.deleted ? `, ${log.deleted} supprimée(s) côté Hospitable (statut deleted)` : ''}`,
    }),
  }).catch(() => {});

  return log;
}

// ── Résas supprimées côté Hospitable ─────────────────────────────────────────
// Jamais d'effacement (historique demandé par Oïhan, 24/09/2026) : final_status='deleted',
// fin_revenue=0, montant et statut d'avant tracés dans journal_ops. Ne s'applique qu'après un
// 404 EXPLICITE de l'API sur la résa elle-même — une simple absence de la liste ne suffit pas.
const SEUIL_SUPPRESSIONS_PAR_MOIS = 10;

async function marquerSupprimee(row) {
  await sb(`reservation?id=eq.${row.id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: JSON.stringify({ final_status: 'deleted', fin_revenue: 0 }),
  });
  await sb('journal_ops', {
    method: 'POST', prefer: 'return=minimal',
    body: JSON.stringify({
      categorie: 'import', action: 'delete_hospitable', statut: 'warning', source: 'sync_hospitable',
      mois_comptable: row.mois_comptable, reservation_id: row.id, bien_id: row.bien_id,
      message: `Réservation ${row.code || row.hospitable_id} supprimée côté Hospitable (404) — conservée en base, statut deleted`,
      avant: { final_status: row.final_status, fin_revenue: row.fin_revenue },
      apres: { final_status: 'deleted', fin_revenue: 0 },
    }),
  }).catch(() => {});
}

// Garde-fou (25/09/2026) : Hospitable renvoie aussi 404 sur des séjours RÉELS passés — nuit du
// 25/09, 11 résas ARREBA/MARNEKO de juillet-août (encaissées, facturées, reversées) passées
// 'deleted' + fin_revenue=0. Un 404 ne prouve la suppression que d'une résa ni payée ni
// commencée : un séjour déjà arrivé ou dont le paiement est rapproché n'est JAMAIS marqué,
// seulement signalé.
async function sejourReel(row) {
  const today = new Date().toISOString().slice(0, 10);
  if (row.arrival_date && row.arrival_date <= today && !['cancelled', 'deleted'].includes(row.final_status)) return true;
  const paiements = await sb(`reservation_paiement?reservation_id=eq.${row.id}&mouvement_id=not.is.null&select=id&limit=1`);
  return (paiements || []).length > 0;
}

async function signalerSejourReel404(row) {
  const deja = await sb(`journal_ops?action=eq.resa_404_sejour_reel&reservation_id=eq.${row.id}&select=id&limit=1`).catch(() => []);
  if ((deja || []).length) return;
  await sb('journal_ops', {
    method: 'POST', prefer: 'return=minimal',
    body: JSON.stringify({
      categorie: 'import', action: 'resa_404_sejour_reel', statut: 'warning', source: 'sync_hospitable',
      mois_comptable: row.mois_comptable, reservation_id: row.id, bien_id: row.bien_id,
      message: `Réservation ${row.code || row.hospitable_id} introuvable côté Hospitable (404) mais séjour commencé ou payé — NON marquée supprimée, à vérifier`,
    }),
  }).catch(() => {});
}

async function est404(hospId) {
  try { await hospFetch(`/v2/reservations/${encodeURIComponent(hospId)}`); return false; }
  catch (e) { return /^Hospitable 404\b/.test(e.message); }
}

// ── Synchro d'UNE résa (webhook) ─────────────────────────────────────────────
// Avant (audit I-149, 24/09/2026) : chaque événement Hospitable relançait syncMois pour le
// mois d'arrivée, pour les DEUX agences (~110s pour DCB en haute saison, 4351 synchros de mois
// en 90 jours, 504 constatés). Ici : 1 appel Hospitable, la seule résa concernée, même écriture
// (ecrireResa). Renvoie null si le bien n'est pas suivi (non listé / inconnu).
async function syncUneResa(hospId) {
  let r;
  try {
    r = await hospFetch(`/v2/reservations/${encodeURIComponent(hospId)}`, { include: 'financials,guest,properties' });
  } catch (e) {
    if (!/^Hospitable 404\b/.test(e.message)) throw e;
    // Supprimée côté Hospitable (ex. événement reservation.deleted) : statut, pas effacement
    const rows = await sb(`reservation?hospitable_id=eq.${encodeURIComponent(hospId)}&final_status=neq.deleted&select=id,hospitable_id,code,bien_id,mois_comptable,fin_revenue,final_status,arrival_date`);
    let deleted = 0;
    for (const row of rows || []) {
      if (await sejourReel(row)) { await signalerSejourReel404(row); continue; }
      await marquerSupprimee(row); deleted++;
    }
    return { deleted, hospitable_id: hospId };
  }
  const resa = r?.data || r;
  if (!resa?.id) throw new Error(`Résa Hospitable introuvable : ${hospId}`);
  const propId = resa.property_id || resa.properties?.[0]?.id || null;
  const biens = await sb(`bien?listed=eq.true&select=id,hospitable_id,hospitable_name,proprietaire_id,provision_ae_ref,forfait_dcb_ref,has_ae,agence,gestion_loyer,forfait_menage_proprio`);
  const bien = (propId && biens.find(b => b.hospitable_id === propId)) || findBienByResa(resa, biens);
  if (!bien) return null;
  resa.property_id = bien.hospitable_id;
  const mois = resa.arrival_date ? resa.arrival_date.substring(0, 7) : null;
  const reservationId = await ecrireResa(resa, bien, mois);
  return { reservation_id: reservationId, code: resa.code, agence: bien.agence, mois_comptable: mois };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (skipDuplicateCron(req, res)) return; // cf. api/_cronGuard.js — crons exécutés par dcb-compta seulement
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Auth : webhook secret (cron) OU JWT Supabase (UI)
  const token = req.query?.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'HOSPITABLE_WEBHOOK_SECRET non configuré' });
  }

  const isCronToken = token === WEBHOOK_SECRET || (CRON_SECRET && token === CRON_SECRET);
  if (!isCronToken) {
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

  // Mode unitaire (webhook) : ?hospitable_id=<uuid résa Hospitable>
  const hospIdParam = req.query?.hospitable_id || req.body?.hospitable_id;
  if (hospIdParam) {
    try {
      const r = await syncUneResa(String(hospIdParam));
      return res.json(r ? { ok: true, ...r } : { ok: true, skipped: 'bien_non_suivi' });
    } catch (err) {
      console.error('[sync-reservations] unitaire', hospIdParam, err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  const agence = req.query?.agence || req.body?.agence || 'dcb';
  const today  = new Date();
  const moisExplicite = req.query?.mois || req.body?.mois;
  const currentMois = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  // Sans ?mois= explicite (cron quotidien) : resynchroniser aussi le mois précédent, pas
  // seulement le mois courant. Sans ça, un statut qui change après la clôture du mois
  // comptable (ex. Airbnb annule tardivement une résa 'checkpoint' faute de vérification
  // d'identité voyageur) n'est plus jamais revu dès que le calendrier bascule sur le mois
  // suivant — le webhook Hospitable est censé rattraper ces changements en temps réel, mais
  // reste actuellement en panne (401, voir project-overview.md). Bug trouvé le 06/09/2026 :
  // résa Maya/HMZATQK95E restée 'checkpoint' en base 6 jours après son annulation réelle,
  // updated_at figé au dernier jour où août était encore le mois courant (31/08 03h00).
  //
  // ?offset=N (crons vercel.json, un appel par mois depuis le 24/09/2026) : ne traite QUE le
  // mois M-N. Le mode "[M-1, M] dans un seul appel" ci-dessous dépassait maxDuration côté DCB
  // en haute saison (août = 178 résas ≈ 110s sur 120s) → la fonction était tuée avant
  // d'attaquer le mois courant, qui n'était donc plus JAMAIS resynchronisé par le cron
  // (import_log : que des lignes 2026-08 à 03h, aucune 2026-09). Découpé en 1 cron par mois,
  // et étendu à M-2 : une résolution Airbnb (remboursement partiel voyageur) peut arriver
  // plusieurs semaines après la fin du séjour (cas VIKY/HM8SZAKKMK, juillet, -1500€ connus
  // seulement mi-août, facture juillet déjà générée → HON surfacturé de 375€ TTC, I-144).
  const moisDecale = (n) => {
    const d = new Date(today.getFullYear(), today.getMonth() - n, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  };
  const offsetParam = req.query?.offset ?? req.body?.offset;
  // offset négatif = mois à venir (-1 = M+1) : les résas futures n'étaient resynchronisées que
  // par le webhook, alors que la ventilation nocturne traite M+1 (I-151).
  const offset = offsetParam != null && /^-?\d+$/.test(String(offsetParam)) ? Number(offsetParam) : null;
  if (offset != null && (offset > 6 || offset < -2)) return res.status(400).json({ error: 'offset entre -2 et 6' });
  const moisAtraiter = moisExplicite ? [moisExplicite]
    : offset != null ? [moisDecale(offset)]
    : [moisDecale(1), currentMois];

  console.log(`[sync-reservations] mois=${moisAtraiter.join(',')} agence=${agence}`);

  try {
    const logs = [];
    for (const m of moisAtraiter) logs.push({ mois: m, ...(await syncMois(m, agence)) });
    const log = logs.reduce((acc, l) => ({
      created: acc.created + l.created, updated: acc.updated + l.updated,
      errors: acc.errors + l.errors, total: acc.total + l.total,
      deleted: acc.deleted + (l.deleted || 0),
      errorDetails: [...acc.errorDetails, ...l.errorDetails],
    }), { created: 0, updated: 0, errors: 0, total: 0, deleted: 0, errorDetails: [] });
    console.log(`[sync-reservations] ✓ créées:${log.created} mises à jour:${log.updated} erreurs:${log.errors}`);
    return res.json({ ok: true, mois: moisAtraiter, agence, ...log, details: logs });
  } catch (err) {
    console.error('[sync-reservations] erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
