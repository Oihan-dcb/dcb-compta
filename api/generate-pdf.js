import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 30,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
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
