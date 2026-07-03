/**
 * POST /api/qualifier-ajustement
 *
 * Qualifie un ajustement Hospitable détecté (voir migration 222 + api/ventiler.js
 * _detecterAjustements) comme "hebergement" (impacte commissionableBase → HON) ou
 * "menage" (impacte uniquement fmenBase), puis déclenche la reventilation de la résa
 * concernée via /api/ventiler pour que le nouveau traitement s'applique immédiatement.
 *
 * Body : { ajustement_id: 'uuid', type: 'hebergement' | 'menage' }
 * Auth : Bearer JWT Supabase valide requis (tout utilisateur authentifié).
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.SUPABASE_URL || 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SRK      = process.env.SUPABASE_SERVICE_ROLE_KEY
const SELF_URL          = 'https://dcb-compta.vercel.app'

async function verifyToken(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
  })
  if (!r.ok) return null
  return r.json()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' })

  if (!SUPABASE_SRK) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configuré' })
  if (!SUPABASE_ANON_KEY) return res.status(500).json({ error: 'SUPABASE_ANON_KEY non configuré' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Token manquant' })
  const user = await verifyToken(token)
  if (!user) return res.status(401).json({ error: 'Non authentifié' })

  const { ajustement_id, type } = req.body || {}
  if (!ajustement_id) return res.status(400).json({ error: 'ajustement_id requis' })
  if (!['hebergement', 'menage'].includes(type))
    return res.status(400).json({ error: "type doit être 'hebergement' ou 'menage'" })

  const supa = createClient(SUPABASE_URL, SUPABASE_SRK)

  try {
    const { data: updated, error: updErr } = await supa
      .from('reservation_ajustement')
      .update({ type, statut: 'traite', qualifie_par: user.email || user.id, qualifie_le: new Date().toISOString() })
      .eq('id', ajustement_id)
      .select('reservation_id')
      .single()
    if (updErr) throw updErr
    if (!updated) return res.status(404).json({ error: 'Ajustement introuvable' })

    // Reventiler la résa concernée avec le nouveau traitement
    const ventilerRes = await fetch(`${SELF_URL}/api/ventiler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ reservation_id: updated.reservation_id }),
    })
    if (!ventilerRes.ok) {
      const detail = await ventilerRes.text().catch(() => '')
      throw new Error(`Reventilation échouée : ${detail}`)
    }

    return res.json({ ok: true, reservation_id: updated.reservation_id })
  } catch (err) {
    console.error('[qualifier-ajustement]', err)
    return res.status(500).json({ error: err.message })
  }
}
