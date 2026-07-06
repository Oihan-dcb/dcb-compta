// Helper partagé — récupère TOUTES les transactions Pennylane d'un compte bancaire,
// en paginant via cursor (le premier import backfill peut dépasser une page).
// Utilisé par api/pennylane-mouvement-sync.js et api/pennylane-lld-sync.js.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'

export async function fetchAllPennylaneTransactions(bankAccountId, supabaseServiceRoleKey, agency = 'DCB') {
  const transactions = []
  let cursor = undefined
  let pages = 0
  const MAX_PAGES = 50 // garde-fou (5000 transactions) — casse la boucle plutôt que de tourner à l'infini

  while (pages < MAX_PAGES) {
    pages++
    const res = await fetch(`${SUPABASE_URL}/functions/v1/pennylane-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseServiceRoleKey}` },
      body: JSON.stringify({
        action: 'listTransactions',
        agency,
        payload: {
          limit: 100,
          cursor,
          filter: [{ field: 'bank_account_id', operator: 'eq', value: bankAccountId }],
        },
      }),
    })
    const { status, data } = await res.json()
    if (status !== 200) throw new Error(`Pennylane listTransactions échoué (${status}) : ${JSON.stringify(data)}`)

    transactions.push(...(data.items || []))
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }

  return transactions
}
