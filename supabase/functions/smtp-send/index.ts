import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SMTP_HOST = Deno.env.get('SMTP_HOST') || ''
const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') || '465')
const SMTP_USER = Deno.env.get('SMTP_USER') || ''
const SMTP_PASS = Deno.env.get('SMTP_PASS') || ''
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    })
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: any
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  const { to, subject, html, attachments } = body
  if (!to || !subject || !html) return new Response('Missing to/subject/html', { status: 400 })
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return new Response('SMTP not configured', { status: 500 })

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
      content: a.content_base64,
      encoding: 'base64',
    }))

    await client.send({
      from: SMTP_FROM,
      to,
      subject,
      html,
      attachments: attachList.length ? attachList : undefined,
    })

    await client.close()

    console.log('Email envoyé à', to, ':', subject)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err: any) {
    console.error('SMTP error:', err)
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
