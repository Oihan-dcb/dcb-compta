/**
 * Client API Hospitable v2
 * Base URL : https://public.api.hospitable.com/v2
 * Auth : Bearer PAT token
 * Montants : en centimes (48489 = €484.89)
 */

const BASE_URL = 'https://public.api.hospitable.com/v2'

// Le token est stocké en Supabase (table config) ou en env pour le dev
let _token = null

export function setToken(token) {
  _token = token
}

async function apiFetch(path, params = {}) {
  if (!_token) throw new Error('Token Hospitable non configuré')

  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([key, val]) => {
    if (Array.isArray(val)) {
      val.forEach(v => url.searchParams.append(`${key}[]`, v))
    } else if (val !== undefined && val !== null) {
      url.searchParams.set(key, val)
    }
  })

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${_token}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Hospitable API ${res.status}: ${err.message || url.pathname}`)
  }

  return res.json()
}

// Paginer automatiquement pour récupérer tous les résultats
async function fetchAll(path, params = {}, pageSize = 50) {
  let page = 1
  let all = []

  while (true) {
    const data = await apiFetch(path, { ...params, limit: pageSize, page })
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
 * @returns {Promise<Array>} Liste des biens
 */
export async function fetchProperties() {
  return fetchAll('/properties')
}

/**
 * Récupère les réservations d'un ou plusieurs biens avec financials
 * @param {string[]} propertyIds - Liste d'IDs Hospitable
 * @param {Object} opts - Options (startDate, endDate, limit)
 * @returns {Promise<Array>} Liste des réservations avec financials
 */
export async function fetchReservations(propertyIds, opts = {}) {
  if (!propertyIds || propertyIds.length === 0) return []

  const params = {
    properties: propertyIds,   // sera transformé en properties[] par apiFetch
    include: 'financials,guests,guest',  // guest pour avoir first_name/last_name
  }
  if (opts.startDate) params.start_date = opts.startDate
  if (opts.endDate) params.end_date = opts.endDate

  return fetchAll('/reservations', params)
}

/**
 * Récupère les payouts (virements) Hospitable
 * @param {Object} opts - Options (startDate, endDate)
 * @returns {Promise<Array>} Liste des payouts
 */
export async function fetchPayouts(opts = {}) {
  const params = { include: 'transactions' }
  if (opts.startDate) params.start_date = opts.startDate
  if (opts.endDate) params.end_date = opts.endDate

  return fetchAll('/payouts', params)
}

/**
 * Récupère les transactions financières
 * @param {Object} opts - Options
 */
export async function fetchTransactions(opts = {}) {
  const params = { include: 'reservation' }
  if (opts.propertyIds) params.properties = opts.propertyIds

  return fetchAll('/transactions', params)
}

/**
 * Formate un montant en centimes en euros
 * @param {number} centimes
 * @returns {string} ex: "€484.89"
 */
export function formatMontant(centimes) {
  if (centimes === null || centimes === undefined) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(centimes / 100)
}

/**
 * Récupère les payouts d'un mois donné avec early exit.
 * L'API Hospitable /payouts trie par date desc mais ignore les filtres de date.
 * On pagine et on s'arrête dès qu'on passe avant le mois cible.
 * @param {string} mois - YYYY-MM
 * @returns {Promise<Array>}
 */
export async function fetchPayoutsForMonth(mois) {
  const [year, month] = mois.split('-').map(Number)
  const startTs = new Date(year, month - 1, 1).getTime()
  const endTs = new Date(year, month, 0, 23, 59, 59).getTime()
  const result = []
  let page = 1

  while (true) {
    const data = await apiFetch('/payouts', { include: 'transactions', limit: 50, page })
    const items = data.data || []
    if (items.length === 0) break

    let pastStart = false
    for (const item of items) {
      const raw = item.date || item.date_payout || item.created_at || ''
      const ts = raw ? new Date(raw).getTime() : 0
      if (ts >= startTs && ts <= endTs) {
        result.push(item)
      } else if (ts < startTs) {
        pastStart = true
      }
    }
    // Payouts triés par date desc → dès qu'on passe avant le début du mois, on s'arrête
    if (pastStart) break

    const meta = data.meta || {}
    if (page >= (meta.last_page || 1)) break
    page++
  }
  return result
}
