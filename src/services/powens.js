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
