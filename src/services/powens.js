/**
 * Service Powens — Open Banking AIS + PIS
 * Toutes les opérations passent par /api/powens-proxy (Vercel serverless)
 * Jamais d'appel direct aux Edge Functions depuis le navigateur
 */

const PROXY = '/api/powens-proxy'

async function call(fn, body) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, ...body }),
  })
  const data = await res.json()
  if (!data.ok && data.error) throw new Error(data.error)
  return data
}

// ── Connexion ─────────────────────────────────────────────────────────────────

/**
 * Retourne l'état de connexion Powens pour un compte
 */
export async function getPowensStatus(agence, accountLabel) {
  return call('powens-auth', { action: 'status', agence, accountLabel })
}

/**
 * Lance le flux de connexion bancaire Powens dans une popup
 * Retourne une Promise qui se résout quand la popup se ferme (succès ou erreur)
 */
export function connectPowens(agence, accountLabel) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Obtenir l'URL webview
      const { webviewUrl } = await call('powens-auth', {
        action: 'init_webview',
        agence,
        accountLabel,
      })

      // 2. Ouvrir la popup
      const popup = window.open(webviewUrl, 'powens_connect', 'width=800,height=700,left=200,top=100')
      if (!popup) return reject(new Error('Popup bloquée — autorisez les popups pour ce site'))

      // 3. Écouter le message postMessage depuis le callback
      const listener = (e) => {
        if (e.data?.type !== 'powens_callback') return
        window.removeEventListener('message', listener)
        clearInterval(pollInterval)
        if (e.data.status === 'success') resolve({ connected: true })
        else reject(new Error('Connexion bancaire annulée ou échouée'))
      }
      window.addEventListener('message', listener)

      // 4. Fallback : poll si la popup est fermée manuellement
      const pollInterval = setInterval(() => {
        if (popup.closed) {
          window.removeEventListener('message', listener)
          clearInterval(pollInterval)
          resolve({ connected: false, cancelled: true })
        }
      }, 1000)

    } catch (err) {
      reject(err)
    }
  })
}

// ── AIS — Transactions ────────────────────────────────────────────────────────

/**
 * Synchronise les transactions depuis Powens → powens_transaction_raw
 */
export async function syncPowensTransactions(agence, accountLabel, dateFrom, dateTo) {
  return call('powens-sync', {
    action: 'sync_transactions',
    agence,
    accountLabel,
    dateFrom,
    dateTo,
  })
}

/**
 * Liste les transactions en attente d'import
 */
export async function listStagedTransactions(agence, accountLabel, mois) {
  const res = await call('powens-sync', { action: 'list_staged', agence, accountLabel, mois })
  return res.transactions || []
}

/**
 * Importe les transactions staged dans mouvement_bancaire
 */
export async function importStagedTransactions(agence, accountLabel, ids, mois) {
  return call('powens-sync', { action: 'import_staged', agence, accountLabel, ids, mois })
}

/**
 * Enregistre le webhook Powens ACCOUNT_SYNCED
 */
export async function setupPowensWebhook(webhookUrl) {
  return call('powens-auth', { action: 'setup_webhook', webhookUrl })
}

/**
 * Synchronise ET importe les 3 comptes Powens en parallèle (seq_lc, seq_lld, courant)
 * Les erreurs par compte sont collectées mais ne bloquent pas les autres.
 */
export async function syncAllPowensAccounts(mois) {
  const [y, m] = mois.split('-').map(Number)
  const dateFrom = `${mois}-01`
  const dateTo = new Date(y, m, 0).toISOString().substring(0, 10)
  const accounts = [
    { agence: 'dcb', accountLabel: 'seq_lc' },
    { agence: 'dcb', accountLabel: 'seq_lld' },
    { agence: 'dcb', accountLabel: 'courant' },
  ]

  // Sync tous les comptes en parallèle
  const syncResults = await Promise.allSettled(
    accounts.map(a => syncPowensTransactions(a.agence, a.accountLabel, dateFrom, dateTo))
  )

  // Import automatique pour les comptes qui ont syncé avec succès
  const importResults = await Promise.allSettled(
    accounts.map((a, i) =>
      syncResults[i].status === 'fulfilled'
        ? importStagedTransactions(a.agence, a.accountLabel, undefined, mois)
        : Promise.reject(new Error('sync échoué'))
    )
  )

  const synced = syncResults.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value?.synced || 0) : 0), 0)
  const imported = importResults.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value?.importe || 0) : 0), 0)
  const errors = syncResults.flatMap((r, i) =>
    r.status === 'rejected' ? [`${accounts[i].accountLabel}: ${r.reason?.message}`] : []
  )
  return { synced, imported, errors }
}
