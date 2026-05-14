import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 30,
}

const SUPABASE_URL      = 'https://omuncchvypbtxkpalwcr.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const ALLOWED_EMAILS    = (process.env.ALLOWED_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dcb-compta.vercel.app')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Vérifier JWT Supabase
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

  const { html, orientation = 'portrait' } = req.body || {}

  if (!html || typeof html !== 'string' || html.length < 100) {
    return res.status(400).json({ error: 'HTML invalide ou manquant' })
  }

  const t0 = Date.now()
  let browser = null

  try {
    const executablePath = await chromium.executablePath()
    console.log(`Chromium path: ${executablePath} (${Date.now()-t0}ms)`)

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    })

    const page = await browser.newPage()

    // Bypass CSP pour éviter les blocages de ressources inline
    await page.setBypassCSP(true)

    // Forcer le mode impression
    await page.emulateMediaType('print')

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 20000,
    })

    // Attendre que toutes les images data: soient décodées
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete || img.naturalWidth === 0)
          .map(img => new Promise((resolve) => {
            img.onload = resolve
            img.onerror = resolve
            setTimeout(resolve, 3000) // fallback
          }))
      )
    })

    console.log(`Page ready (${Date.now()-t0}ms)`)

    const pdf = await page.pdf({
      format: 'A4',
      landscape: orientation === 'landscape',
      printBackground: true,
      margin: { top: '8mm', right: '6mm', bottom: '8mm', left: '6mm' },
    })

    console.log(`PDF generated ${pdf.length} bytes (${Date.now()-t0}ms)`)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="rapport.pdf"')
    res.send(Buffer.from(pdf))

  } catch (error) {
    console.error('PDF error:', error.message)
    res.status(500).json({ error: error.message })
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
