import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'

export const config = {
  maxDuration: 30,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { html } = req.body

  if (!html) {
    return res.status(400).json({ error: 'HTML requis' })
  }

  let browser = null

  try {
    const chromiumPath = await chromium.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'
    )

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: chromiumPath,
      headless: chromium.headless,
    })

    const page = await browser.newPage()

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 20000,
    })

    // Attendre que les images data: soient rendues
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise(resolve => {
            img.onload = img.onerror = resolve
          }))
      )
    })

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', right: '6mm', bottom: '8mm', left: '6mm' },
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="rapport.pdf"')
    res.send(Buffer.from(pdf))

  } catch (error) {
    console.error('PDF generation error:', error)
    res.status(500).json({ error: error.message })
  } finally {
    if (browser) await browser.close()
  }
}
