/**
 * Client API Hospitable v2
 * Les appels transitent par /api/hospitable-proxy (token serveur, jamais exposé)
 * Montants : en centimes (48489 = €484.89)
 */

import { supabase } from './supabase'

async function apiFetch(path, params = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expirée — veuillez vous reconnecter')

  const url = new URL('/api/hospitable-proxy', window.location.origin)
  url.searchParams.set('path', path)
  Object.entries(params).forEach(([key, val]) => {
    if (Array.isArray(val)) {
      val.forEach(v => url.searchParams.append(key, v))
    } else if (val !== undefined && val !== null) {
      url.searchParams.set(key, val)
    }
  })

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Hospitable API ${res.status}: ${err.message || err.error || path}`)
  }

  return res.json()
}

// Paginer automatiquement pour récupérer tous les résultats
async function fetchAll(path, params = {}, pageSize = 50) {
  let page = 1
  let all = []

  while (true) {
    const data = await apiFetch(path, { ...params, per_page: pageSize, page })
    const items = data.data || []
    all = all.concat(items)

    const meta = data.meta || {}
    const lastPage = meta.last_page || 1
    const total = meta.total || items.length
    if (page >= lastPage || all.length >= total) break
    page++
  }

  return all
}

/**
 * Récupère tous les biens actifs
 */
export async function fetchProperties() {
  return fetchAll('/v2/properties')
}

/**
 * Récupère les réservations d'un ou plusieurs biens avec financials
 * @param {string[]} propertyIds - Liste d'IDs Hospitable
 * @param {Object} opts - Options (startDate, endDate)
 */
export async function fetchReservations(propertyIds, opts = {}) {
  if (!propertyIds || propertyIds.length === 0) return []

  const params = {
    properties: propertyIds,
    include: 'financials,guest',
  }
  if (opts.startDate) params.start_date = opts.startDate
  if (opts.endDate) params.end_date = opts.endDate

  return fetchAll('/v2/reservations', params)
}

/**
 * Récupère les transactions financières
 */
export async function fetchTransactions(opts = {}) {
  const params = { include: 'reservation' }
  if (opts.propertyIds) params.properties = opts.propertyIds

  return fetchAll('/v2/transactions', params)
}

/**
 * Récupère une page de payouts (sans transactions)
 */
export async function fetchPayoutsList({ page = 1, per_page = 100 } = {}) {
  return apiFetch('/v2/payouts', { page, per_page })
}

/**
 * Récupère un payout avec ses transactions détaillées
 */
export async function fetchPayoutDetail(uuid) {
  return apiFetch(`/v2/payouts/${uuid}`, { include: 'transactions' })
}

/**
 * Formate un montant en centimes en euros
 */
export function formatMontant(centimes) {
  if (centimes === null || centimes === undefined) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(centimes / 100)
}
