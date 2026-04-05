import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SMTP_HOST = Deno.env.get('SMTP_HOST') || ''
const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') || '465')
const SMTP_USER = Deno.env.get('SMTP_USER') || ''
const SMTP_PASS = Deno.env.get('SMTP_PASS') || ''
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}
const jsonCors = { 'Content-Type': 'application/json', ...CORS }

const err = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: jsonCors })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return err('Method Not Allowed', 405)

  let body: any
  try { body = await req.json() } catch { return err('Invalid JSON', 400) }

  const { to, cc, subject, html, attachments } = body
  if (!to || !subject || !html) return err('Missing to/subject/html', 400)
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return err('SMTP not configured', 500)

  try {
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: SMTP_PORT === 465,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    })

    const attachList = (attachments || []).map((a: any) => ({
      filename: a.filename,
      mimeType: 'application/pdf',
      content: a.content_base64,
      encoding: 'base64',
    }))

    await client.send({
      from: SMTP_FROM,
      to,
      cc: cc || undefined,
      subject,
      html,
      attachments: attachList.length ? attachList : undefined,
    })

    await client.close()

    console.log('Email envoyé à', to, ':', subject)
    return new Response(JSON.stringify({ ok: true }), { headers: jsonCors })
  } catch (e: any) {
    console.error('SMTP error:', e)
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: jsonCors })
  }
})
