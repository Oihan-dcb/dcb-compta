// owner-mailing — Publipostage propriétaires (staff DCB), envoyé VIA LA BOÎTE (SMTP).
// POST { subject, body, recipients:[{proprio_id,email,prenom,nom,bien}], from_name?, reply_to?, campaign? }
//   → envoie un email PERSONNALISÉ par destinataire depuis oihan@destinationcotebasque.com
//   (SMTP Google Workspace), balises {{prenom}} {{nom}} {{bien}}, signature + pixel d'ouverture.
// Secrets requis : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TRACK = 'https://dcb-planning.vercel.app/api/mail-open'
const SIG_URL = 'https://omuncchvypbtxkpalwcr.supabase.co/storage/v1/object/public/rapport-assets/email/signature-oihan.png'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Non authentifié' }, 401)
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY)
    if (token !== SERVICE_KEY) {
      const { data: { user: caller } } = await admin.auth.getUser(token)
      if (!caller) return json({ error: 'Token invalide' }, 401)
      const allowed = (Deno.env.get('ALLOWED_STAFF_EMAILS') ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      if (allowed.length && !allowed.includes(caller.email?.toLowerCase() ?? '')) return json({ error: 'Accès refusé' }, 403)
    }

    const { subject, body, recipients, from_name, reply_to, campaign } = await req.json()
    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return json({ error: 'subject, body et recipients requis' }, 400)
    }

    const HOST = Deno.env.get('SMTP_HOST'), PORT = Deno.env.get('SMTP_PORT')
    const USER = Deno.env.get('SMTP_USER'), PASS = Deno.env.get('SMTP_PASS')
    const FROM_ADDR = Deno.env.get('SMTP_FROM') || USER
    if (!HOST || !PORT || !USER || !PASS || !FROM_ADDR) {
      return json({ error: 'Boîte non connectée — secrets SMTP manquants (SMTP_HOST/PORT/USER/PASS/FROM).' }, 400)
    }
    const fromName = (from_name || 'Oïhan — Destination Côte Basque').replace(/[<>\n"]/g, '').trim()
    const replyTo = reply_to || FROM_ADDR
    const camp = (campaign || ('pub-' + new Date().toISOString().slice(0, 16))).toString()

    const client = new SMTPClient({
      connection: { hostname: HOST, port: Number(PORT), tls: true, auth: { username: USER, password: PASS } },
    })

    const merge = (s: string, r: any) => String(s ?? '')
      .replaceAll('{{prenom}}', r.prenom ?? '').replaceAll('{{nom}}', r.nom ?? '').replaceAll('{{bien}}', r.bien ?? '')

    const results: any[] = []
    for (const r of recipients) {
      const to = String(r.email || '').split(/[,;]/)[0].trim()
      if (!to || !to.includes('@')) { results.push({ email: r.email, ok: false, err: 'email invalide' }); continue }
      const tok = crypto.randomUUID()
      const bodyHtml = esc(merge(body, r)).replace(/\n/g, '<br>')
      const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 20px;font-size:15px;line-height:1.7;color:#2C2416">
${bodyHtml}
<div style="margin-top:24px"><img src="${SIG_URL}" alt="Oïhan — Destination Côte Basque" width="360" style="max-width:360px;width:100%;height:auto;display:block"/></div>
</div>
<img src="${TRACK}?t=${tok}" width="1" height="1" style="display:none" alt=""/>
</body></html>`
      try {
        await client.send({
          from: `${fromName} <${FROM_ADDR}>`,
          to,
          replyTo,
          subject: merge(subject, r),
          html,
          content: 'text/html',
        })
        results.push({ email: to, ok: true })
        await admin.from('mailing_open').insert({ token: tok, campaign: camp, proprietaire_id: r.proprio_id ?? null, email: to, subject: merge(subject, r) })
      } catch (e) {
        results.push({ email: to, ok: false, err: (e as Error).message })
      }
    }
    try { await client.close() } catch { /* noop */ }
    return json({ ok: true, campaign: camp, sent: results.filter(r => r.ok).length, total: results.length, results })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
