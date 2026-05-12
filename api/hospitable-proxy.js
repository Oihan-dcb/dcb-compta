// GET /api/hospitable-proxy?path=/v2/...&[params...]
// Proxy strict vers public.api.hospitable.com/v2
// Requis : JWT Supabase valide + email dans ALLOWED_ADMIN_EMAILS

const HOSPITABLE_TOKEN   = process.env.HOSPITABLE_TOKEN
const SUPABASE_URL       = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY
const ALLOWED_EMAILS     = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

// Chemins autorisés — liste fermée, GET uniquement
// /v2/payouts/{uuid} autorisé via regex ci-dessous
const PATH_ALLOWLIST = [
  '/v2/properties',
  '/v2/reservations',
  '/v2/transactions',
  '/v2/payouts',
]

function isPathAllowed(path) {
  const clean = path.split('?')[0]
  for (const allowed of PATH_ALLOWLIST) {
    if (clean === allowed) return true
    // Autoriser sous-ressource UUID pour payouts uniquement
    if (allowed === '/v2/payouts' && /^\/v2\/payouts\/[0-9a-f-]{8,}$/.test(clean)) return true
  }
  return false
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET uniquement' })

  if (!HOSPITABLE_TOKEN) return res.status(500).json({ error: 'HOSPITABLE_TOKEN non configuré' })
  if (!SUPABASE_ANON_KEY) return res.status(500).json({ error: 'SUPABASE_ANON_KEY non configuré' })

  // 1. Vérifier JWT Supabase
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Token manquant' })

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  })
  if (!authRes.ok) return res.status(401).json({ error: 'Non authentifié' })
  const { email } = await authRes.json()

  // 2. Vérifier que l'email est dans la liste admin
  if (!ALLOWED_EMAILS.length) return res.status(500).json({ error: 'ALLOWED_ADMIN_EMAILS non configuré' })
  if (!ALLOWED_EMAILS.includes((email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Accès refusé' })
  }

  // 3. Valider le path (allowlist stricte)
  const { path, ...params } = req.query
  if (!path || !isPathAllowed(path)) {
    return res.status(400).json({ error: 'Path non autorisé : ' + path })
  }

  // 4. Relayer vers Hospitable API
  const url = new URL('https://public.api.hospitable.com' + path)
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(vi => url.searchParams.append(k, vi))
    else url.searchParams.set(k, v)
  })

  const hospRes = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + HOSPITABLE_TOKEN, Accept: 'application/json' }
  })
  const data = await hospRes.json()
  return res.status(hospRes.status).json(data)
}
