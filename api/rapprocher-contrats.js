// POST /api/rapprocher-contrats
// Rapproche automatiquement contract_payments ↔ mouvement_bancaire (Stripe)
// Critères : canal=stripe, credit=amount_cts, date dans [paid_at, paid_at+7j], non déjà lié
// Requis : JWT Supabase valide + email dans ALLOWED_ADMIN_EMAILS

const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY
const ALLOWED_EMAILS    = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...options.headers,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' })

  // Vérifier JWT
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Token manquant' })
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  })
  if (!authRes.ok) return res.status(401).json({ error: 'Non authentifié' })
  const { email } = await authRes.json()
  if (!ALLOWED_EMAILS.length) return res.status(500).json({ error: 'ALLOWED_ADMIN_EMAILS non configuré' })
  if (!ALLOWED_EMAILS.includes((email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Accès refusé' })
  }

  const { agence = 'dcb' } = req.body || {}

  try {
    // ── 1. Paiements contrat succeeded, non encore rapprochés ────────────────
    const paiements = await sb(
      `contract_payments?statut=eq.succeeded&mouvement_bancaire_id=is.null&agence=eq.${agence}&select=id,amount_cts,paid_at,contract_id,type,stripe_payment_intent_id`
    )
    if (!paiements || paiements.length === 0) {
      return res.json({ matched: 0, skipped: 0, message: 'Aucun paiement à rapprocher' })
    }

    // ── 2. Mouvements Stripe entrants non encore liés à contract_payments ────
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    const mouvements = await sb(
      `mouvement_bancaire?canal=eq.stripe&credit=gt.0&date_operation=gte.${since}&select=id,credit,date_operation,statut_matching,detail`
    )

    // Mouvements déjà liés (éviter double-liaison)
    const dejaLies = await sb(
      `contract_payments?mouvement_bancaire_id=not.is.null&agence=eq.${agence}&select=mouvement_bancaire_id`
    )
    const mouvsUtilises = new Set((dejaLies || []).map(p => p.mouvement_bancaire_id))

    // ── 3. Matching par montant + fenêtre date (paid_at → +7j) ───────────────
    let matched = 0, skipped = 0
    const details = []

    for (const paiement of paiements) {
      if (!paiement.paid_at || !paiement.amount_cts) { skipped++; continue }

      const paidAt    = new Date(paiement.paid_at)
      const paidAtMax = new Date(paidAt.getTime() + 7 * 86400000)
      const creditCible = paiement.amount_cts

      const candidat = (mouvements || []).find(m =>
        m.credit === creditCible &&
        !mouvsUtilises.has(m.id) &&
        new Date(m.date_operation) >= paidAt &&
        new Date(m.date_operation) <= paidAtMax
      )

      if (!candidat) { skipped++; continue }

      mouvsUtilises.add(candidat.id)

      // Lier contract_payment → mouvement_bancaire
      await sb(`contract_payments?id=eq.${paiement.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          mouvement_bancaire_id: candidat.id,
          rapproche_banque_at: new Date().toISOString(),
        }),
      })

      // Annoter le mouvement bancaire
      const nouveauDetail = [
        candidat.detail || '',
        `💳 Contrat ${paiement.contract_id} — ${paiement.type}`,
      ].filter(Boolean).join(' | ')

      await sb(`mouvement_bancaire?id=eq.${candidat.id}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          statut_matching: 'rapproche',
          detail: nouveauDetail,
        }),
      })

      matched++
      details.push({
        paiement_id:  paiement.id,
        mouvement_id: candidat.id,
        contract_id:  paiement.contract_id,
        type:         paiement.type,
        montant:      creditCible / 100,
      })
    }

    return res.json({ matched, skipped, details, message: `${matched} rapprochement(s) effectué(s)` })
  } catch (err) {
    console.error('[rapprocher-contrats]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
