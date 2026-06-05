// POST /api/rapport-to-portail
// { html, orientation, proprio_id, bien_id, mois, bien_name }
// Côté serveur : génère PDF, upload Supabase Storage, upsert owner_documents, notifie portail
// Évite tout envoi de binaire depuis le navigateur (fix Safari "Load failed")
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = { maxDuration: 60 }

const SUPABASE_URL       = 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY
const SUPABASE_SRV_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const ALLOWED_EMAILS     = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
const PORTAIL_URL        = 'https://portail-owner.destinationcotebasque.com'

function setCors(res, req) {
  const origin = req.headers.origin || ''
  const allowed = (
    origin === 'https://dcb-compta.vercel.app' ||
    origin.endsWith('-oihans-projects-470f9638.vercel.app') ||
    origin.endsWith('.destinationcotebasque.com') ||
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:4173'
  )
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  setCors(res, req)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth staff ────────────────────────────────────────────────────────────
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Token manquant' })

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
  })
  if (!authRes.ok) return res.status(401).json({ error: 'Non authentifié' })
  const { email } = await authRes.json()
  if (!ALLOWED_EMAILS.length) return res.status(500).json({ error: 'ALLOWED_ADMIN_EMAILS non configuré' })
  if (!ALLOWED_EMAILS.includes((email || '').toLowerCase())) return res.status(403).json({ error: 'Accès refusé' })

  const { html, orientation = 'landscape', proprio_id, bien_id, mois, bien_name = '' } = req.body || {}
  if (!html || typeof html !== 'string' || html.length < 100) return res.status(400).json({ error: 'html invalide' })
  if (!proprio_id || !bien_id || !mois) return res.status(400).json({ error: 'proprio_id, bien_id, mois requis' })

  // ── 1. Génération PDF ─────────────────────────────────────────────────────
  let browser = null
  let pdf
  try {
    const executablePath = await chromium.executablePath()
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    })
    const page = await browser.newPage()
    await page.setBypassCSP(true)
    await page.emulateMediaType('print')
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 })
    await page.evaluate(() => Promise.all(
      Array.from(document.images)
        .filter(img => !img.complete || img.naturalWidth === 0)
        .map(img => new Promise(resolve => {
          img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 3000)
        }))
    ))
    pdf = await page.pdf({
      format: 'A4',
      landscape: orientation === 'landscape',
      printBackground: true,
      margin: { top: '8mm', right: '6mm', bottom: '8mm', left: '6mm' },
    })
  } catch (err) {
    return res.status(500).json({ error: `PDF: ${err.message}` })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  // ── 2. Upload Supabase Storage ────────────────────────────────────────────
  const storagePath = `rapports/${proprio_id}/${bien_id}/${mois}.pdf`
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/owner-documents/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SRV_KEY,
        Authorization: `Bearer ${SUPABASE_SRV_KEY}`,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: pdf,
    }
  )
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => '')
    return res.status(500).json({ error: `Storage: ${t.slice(0, 120)}` })
  }

  // ── 3. Upsert owner_documents ─────────────────────────────────────────────
  const [year, month] = mois.split('-').map(Number)
  const moisLabel = new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const bienLabel = bien_name || bien_id.slice(0, 8)
  const nomDoc = `Rapport ${moisLabel} — ${bienLabel}`

  const srvHeaders = {
    apikey: SUPABASE_SRV_KEY,
    Authorization: `Bearer ${SUPABASE_SRV_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  }

  // Supprimer l'éventuel doublon
  await fetch(
    `${SUPABASE_URL}/rest/v1/owner_documents?proprietaire_id=eq.${encodeURIComponent(proprio_id)}&bien_id=eq.${encodeURIComponent(bien_id)}&mois_comptable=eq.${encodeURIComponent(mois)}&categorie=eq.releve`,
    { method: 'DELETE', headers: srvHeaders }
  )

  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/owner_documents`, {
    method: 'POST',
    headers: { ...srvHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      proprietaire_id: proprio_id,
      bien_id,
      nom: nomDoc,
      categorie: 'releve',
      storage_path: storagePath,
      date_document: `${mois}-01`,
      mois_comptable: mois,
    }),
  })
  if (!insRes.ok) {
    const t = await insRes.text().catch(() => '')
    return res.status(500).json({ error: `DB insert: ${t.slice(0, 120)}` })
  }

  // ── 4. Notification portail (server-to-server, pas de CORS) ──────────────
  let sent = false
  let notifErr = ''
  try {
    const notifRes = await fetch(`${PORTAIL_URL}/api/notify-proprio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ proprio_id, bien_id, mois, type: 'releve', extra: { bienName: bienLabel } }),
    })
    const j = await notifRes.json().catch(() => ({}))
    sent = notifRes.ok && !!j.sent
    if (!notifRes.ok) notifErr = j.error || `notify HTTP ${notifRes.status}`
  } catch (e) {
    notifErr = e.message || 'notify réseau'
  }

  return res.json({ ok: true, sent, nom: nomDoc, notifErr: notifErr || undefined })
}
