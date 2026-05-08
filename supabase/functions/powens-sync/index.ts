/**
 * Supabase Edge Function — Powens Sync (AIS)
 * Récupère les transactions bancaires depuis Powens et les stocke dans powens_transaction_raw
 *
 * Actions :
 *   sync_transactions  → pull depuis Powens → upsert powens_transaction_raw
 *   import_staged      → pousse powens_transaction_raw → mouvement_bancaire
 *   list_staged        → retourne les transactions en attente d'import
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE_URL = Deno.env.get('POWENS_BASE_URL')!
const SUPA_URL = Deno.env.get('SUPABASE_URL')!
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function supabase() {
  return createClient(SUPA_URL, SUPA_KEY)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getValidToken(db: ReturnType<typeof supabase>, agence: string, accountLabel: string): Promise<string> {
  const { data: conn } = await db
    .from('powens_connection')
    .select('access_token, connection_state')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  if (!conn || conn.connection_state !== 'connected') {
    throw new Error(`Connexion Powens non active pour ${agence}/${accountLabel}`)
  }

  // Flux token Powens : le user token est permanent (pas de refresh)
  return conn.access_token
}

// Détecte le canal depuis le libellé (même logique que importBanque.js)
function detectCanal(libelle: string, montantCentimes: number): string {
  const l = (libelle || '').toLowerCase()
  if (l.includes('airbnb')) return 'airbnb'
  if (l.includes('booking')) return 'booking'
  if (l.includes('stripe')) return 'stripe'
  if (l.includes('vir') || l.includes('virement')) return 'virement'
  if (l.includes('chq') || l.includes('cheque') || l.includes('chèque')) return 'cheque'
  if (l.includes('cb') || l.includes('carte')) return 'carte'
  if (l.includes('prlv') || l.includes('prélèvement')) return 'prelevement'
  if (l.includes('frais') || l.includes('commission banque')) return 'frais_bancaires'
  return montantCentimes > 0 ? 'credit' : 'debit'
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function syncTransactions(agence: string, accountLabel: string, dateFrom?: string, dateTo?: string) {
  const db = supabase()
  const token = await getValidToken(db, agence, accountLabel)

  // Récupérer l'account_id Powens
  const { data: conn } = await db
    .from('powens_connection')
    .select('powens_account_id')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  if (!conn?.powens_account_id) throw new Error('powens_account_id manquant — reconnectez la banque')

  // Construire l'URL avec filtres de date
  const params = new URLSearchParams({ limit: '500' })
  if (dateFrom) params.set('min_date', dateFrom)
  if (dateTo) params.set('max_date', dateTo)

  // Filtrer par compte via le chemin (le query param id_account n'est pas supporté)
  const url = `${BASE_URL}/users/me/accounts/${conn.powens_account_id}/transactions?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })

  if (!res.ok) {
    const err = await res.text()
    // Token expiré → marquer la connexion comme expirée
    if (res.status === 401) {
      await db.from('powens_connection').update({
        connection_state: 'expired',
        last_error: 'Token expiré — reconnexion requise',
        updated_at: new Date().toISOString(),
      }).eq('agence', agence).eq('account_label', accountLabel)
    }
    throw new Error(`Powens transactions failed ${res.status}: ${err.substring(0, 200)}`)
  }

  const body = await res.json()
  const transactions = body.transactions || []

  if (transactions.length === 0) {
    await db.from('powens_connection').update({ last_sync_at: new Date().toISOString() })
      .eq('agence', agence).eq('account_label', accountLabel)
    return { synced: 0, new: 0 }
  }

  // Upsert dans powens_transaction_raw
  const rows = transactions.map((tx: any) => {
    const montantCentimes = Math.round((tx.value || 0) * 100)
    return {
      powens_transaction_id: String(tx.id),
      powens_account_id: String(tx.id_account),
      agence,
      raw_payload: tx,
      date_operation: tx.date,
      date_valeur: tx.rdate || tx.date,
      libelle: (tx.label || '').substring(0, 200),
      detail: (tx.raw_label || tx.original_wording || tx.label || '').substring(0, 200),
      montant_centimes: montantCentimes,
      type_powens: tx.type,
      statut: 'a_importer',
    }
  })

  const { error, count } = await db.from('powens_transaction_raw')
    .upsert(rows, { onConflict: 'powens_transaction_id', ignoreDuplicates: true })
    .select('id', { count: 'exact' })

  if (error) throw new Error(`Upsert transactions: ${error.message}`)

  await db.from('powens_connection').update({
    last_sync_at: new Date().toISOString(),
    last_error: null,
  }).eq('agence', agence).eq('account_label', accountLabel)

  return { synced: transactions.length, new: count || 0 }
}

async function listStaged(agence: string, accountLabel: string, mois?: string) {
  const db = supabase()

  // Récupérer le powens_account_id pour ce compte
  const { data: conn } = await db
    .from('powens_connection')
    .select('powens_account_id')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  let query = db.from('powens_transaction_raw')
    .select('*')
    .eq('agence', agence)
    .eq('statut', 'a_importer')
    .order('date_operation', { ascending: false })

  if (conn?.powens_account_id) {
    query = query.eq('powens_account_id', conn.powens_account_id)
  }

  if (mois) {
    const [y, m] = mois.split('-').map(Number)
    const lastDay = new Date(y, m, 0).toISOString().substring(0, 10)
    query = query.gte('date_operation', `${mois}-01`).lte('date_operation', lastDay)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

async function importStaged(agence: string, accountLabel: string, ids?: string[], mois?: string) {
  const db = supabase()

  // Récupérer le powens_account_id pour ne traiter que les transactions de ce compte
  const { data: conn } = await db
    .from('powens_connection')
    .select('powens_account_id')
    .eq('agence', agence)
    .eq('account_label', accountLabel)
    .single()

  let query = db.from('powens_transaction_raw')
    .select('*')
    .eq('agence', agence)
    .eq('statut', 'a_importer')

  if (conn?.powens_account_id) query = query.eq('powens_account_id', conn.powens_account_id)

  if (ids?.length) query = query.in('powens_transaction_id', ids)
  else if (mois) {
    const [y, m] = mois.split('-').map(Number)
    const lastDay = new Date(y, m, 0).toISOString().substring(0, 10)
    query = query.gte('date_operation', `${mois}-01`).lte('date_operation', lastDay)
  }

  const { data: staged, error } = await query
  if (error) throw error
  if (!staged?.length) return { importe: 0, erreurs: [] }

  const erreurs: string[] = []
  let importe = 0

  for (const tx of staged) {
    try {
      const credit = tx.montant_centimes > 0 ? tx.montant_centimes : null
      const debit  = tx.montant_centimes < 0 ? Math.abs(tx.montant_centimes) : null
      const moisReleve = (tx.date_operation || '').substring(0, 7)

      let insertedId: string | null = null

      if (accountLabel === 'seq_lld') {
        // → lld_mouvement_bancaire (compte loyers)
        const { data: mvt, error: mvtErr } = await db.from('lld_mouvement_bancaire')
          .upsert({
            numero_operation: `POWENS_${tx.powens_transaction_id}`,
            date_operation: tx.date_operation,
            libelle: tx.libelle,
            detail: tx.detail,
            credit,
            debit,
            compte: 'loyers',
            mois_releve: moisReleve,
            statut: 'non_rapproche',
            agence,
          }, { onConflict: 'numero_operation,compte,agence' })
          .select('id')
          .single()
        if (mvtErr) throw new Error(mvtErr.message)
        insertedId = mvt.id
      } else {
        // seq_lc, courant → mouvement_bancaire
        const canal = detectCanal(tx.libelle || '', tx.montant_centimes)
        const { data: mvt, error: mvtErr } = await db.from('mouvement_bancaire')
          .upsert({
            numero_operation: `POWENS_${tx.powens_transaction_id}`,
            date_operation: tx.date_operation,
            libelle: tx.libelle,
            detail: tx.detail,
            credit,
            debit,
            canal,
            source: `Powens_${accountLabel}`,
            mois_releve: moisReleve,
            statut_matching: 'en_attente',
            agence,
          }, { onConflict: 'numero_operation' })
          .select('id')
          .single()
        if (mvtErr) throw new Error(mvtErr.message)
        insertedId = mvt.id
      }

      await db.from('powens_transaction_raw').update({
        statut: 'importe',
        mouvement_bancaire_id: insertedId,
        imported_at: new Date().toISOString(),
      }).eq('powens_transaction_id', tx.powens_transaction_id)

      importe++
    } catch (err: any) {
      erreurs.push(`${tx.powens_transaction_id}: ${err.message}`)
    }
  }

  return { importe, erreurs }
}

// ── Serve ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { action, agence, accountLabel, dateFrom, dateTo, ids, mois } = await req.json()

    let result
    switch (action) {
      case 'sync_transactions':
        result = await syncTransactions(agence, accountLabel, dateFrom, dateTo)
        break
      case 'list_staged':
        result = { transactions: await listStaged(agence, accountLabel, mois) }
        break
      case 'import_staged':
        result = await importStaged(agence, accountLabel, ids, mois)
        break
      default:
        throw new Error(`Action inconnue: ${action}`)
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
