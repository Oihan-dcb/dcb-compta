// Garde-fou anti-doublon inter-sources pour les imports bancaires (Pennylane ↔ CSV manuel).
//
// Contexte : un mouvement bancaire déjà importé via CSV manuel (source != Pennylane_*)
// et le même mouvement récupéré via l'API Pennylane ne partagent PAS le même
// numero_operation (l'un vient du relevé, l'autre de l'id Pennylane) — l'index unique
// sur numero_operation ne peut donc pas les voir comme doublons. On les détecte ici par
// (date, montant, libellé) avant l'import.
//
// Constaté sur données réelles (06/07/2026) : le libellé Pennylane est le libellé
// bancaire brut + un suffixe "\n- Reason: ..." — d'où le match par PRÉFIXE plutôt
// qu'égalité stricte (dans les deux sens, selon qui importe après qui).
//
// Bidirectionnel : `direction: 'nonPennylane'` (défaut) = utilisé par
// api/pennylane-mouvement-sync.js et api/pennylane-lld-sync.js pour vérifier qu'un CSV
// manuel n'a pas déjà importé la transaction avant Pennylane. `direction: 'pennylane'` =
// utilisé par l'import CSV manuel (PageBanque.jsx) pour vérifier l'inverse — cas réel du
// 09/07/2026 : import CSV Caisse Epargne fait APRÈS que Pennylane ait déjà synchronisé les
// mêmes jours (11 mouvements dupliqués, dont 1 double paiement résa Skelton/Villa Ontzi).

export async function filtrerTransactionsDupliquees(supabase, { table, agence, extraEq = {}, transactions, direction = 'nonPennylane' }) {
  if (!transactions.length) return { transactions: [], doublonsEvites: 0 }

  const dates = transactions.map(t => t.date).filter(Boolean).sort()
  if (!dates.length) return { transactions: [], doublonsEvites: 0 }
  const dateMin = dates[0]
  const dateMax = dates[dates.length - 1]

  let query = supabase
    .from(table)
    .select('date_operation, libelle, credit, debit')
    .eq('agence', agence)
    .gte('date_operation', dateMin)
    .lte('date_operation', dateMax)
  query = direction === 'pennylane'
    ? query.like('numero_operation', 'PENNYLANE_%')
    : query.not('numero_operation', 'like', 'PENNYLANE_%')
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
    // Le libellé Pennylane est toujours "raw + suffixe" — le plus court est un préfixe
    // de l'autre, peu importe lequel des deux est "nouveau" ou "existant".
    const estDoublon = candidats.some(c => c && (lib.startsWith(c) || c.startsWith(lib)))
    if (estDoublon) doublonsEvites++
    return !estDoublon
  })

  return { transactions: restants, doublonsEvites }
}
