// Garde-fou anti-doublon inter-sources pour les imports Pennylane.
//
// Contexte : un mouvement bancaire déjà importé via CSV manuel (source != Pennylane_*)
// et le même mouvement récupéré via l'API Pennylane ne partagent PAS le même
// numero_operation (l'un vient du relevé, l'autre de l'id Pennylane) — l'index unique
// sur numero_operation ne peut donc pas les voir comme doublons. On les détecte ici par
// (date, montant, libellé) avant l'import.
//
// Constaté sur données réelles (06/07/2026) : le libellé Pennylane est le libellé
// bancaire brut + un suffixe "\n- Reason: ..." — d'où le match par PRÉFIXE plutôt
// qu'égalité stricte.
//
// Utilisé par api/pennylane-mouvement-sync.js et api/pennylane-lld-sync.js.

export async function filtrerTransactionsDupliquees(supabase, { table, agence, extraEq = {}, transactions }) {
  if (!transactions.length) return { transactions: [], doublonsEvites: 0 }

  const dates = transactions.map(t => t.date).filter(Boolean).sort()
  if (!dates.length) return { transactions: [], doublonsEvites: 0 }
  const dateMin = dates[0]
  const dateMax = dates[dates.length - 1]

  let query = supabase
    .from(table)
    .select('date_operation, libelle, credit, debit')
    .eq('agence', agence)
    .not('numero_operation', 'like', 'PENNYLANE_%')
    .gte('date_operation', dateMin)
    .lte('date_operation', dateMax)
  for (const [k, v] of Object.entries(extraEq)) query = query.eq(k, v)

  const { data: existants, error } = await query
  if (error) throw error

  const keyOf = (date, credit, debit) => `${date}|${credit || ''}|${debit || ''}`

  const index = new Map()
  for (const e of (existants || [])) {
    const key = keyOf(e.date_operation, e.credit, e.debit)
    if (!index.has(key)) index.set(key, [])
    index.get(key).push((e.libelle || '').trim())
  }

  let doublonsEvites = 0
  const restants = transactions.filter(tx => {
    const montant = Number(tx.amount)
    const estDebit = montant < 0
    const montantCentimes = Math.round(Math.abs(montant) * 100)
    const key = keyOf(tx.date, estDebit ? 0 : montantCentimes, estDebit ? montantCentimes : 0)
    const candidats = index.get(key) || []
    const lib = (tx.label || '').trim()
    const estDoublon = candidats.some(c => c && lib.startsWith(c))
    if (estDoublon) doublonsEvites++
    return !estDoublon
  })

  return { transactions: restants, doublonsEvites }
}
