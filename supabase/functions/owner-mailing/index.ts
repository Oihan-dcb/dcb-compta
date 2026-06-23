// owner-mailing — Publipostage propriétaires (staff DCB).
// POST { subject, body, recipients:[{email,prenom,nom,bien}], from_name?, reply_to? }
//   → envoie un email PERSONNALISÉ par destinataire (un par un) via Resend.
//   Balises supportées dans subject/body : {{prenom}} {{nom}} {{bien}}
//   Expéditeur sur domaine vérifié (mail.destinationcotebasque.com), reply-to = vraie adresse.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // Auth staff
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Non authentifié' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: { user: caller } } = await admin.auth.getUser(token)
    if (!caller) return json({ error: 'Token invalide' }, 401)
    const allowed = (Deno.env.get('ALLOWED_STAFF_EMAILS') ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    if (allowed.length && !allowed.includes(caller.email?.toLowerCase() ?? '')) return json({ error: 'Accès refusé' }, 403)

    const { subject, body, recipients, from_name, reply_to } = await req.json()
    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return json({ error: 'subject, body et recipients requis' }, 400)
    }
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY non configuré' }, 500)

    const fromName = (from_name || 'Oihan Campandegui').replace(/[<>\n"]/g, '').trim()
    const from = `${fromName} <oihan@mail.destinationcotebasque.com>`
    const replyTo = reply_to || 'oihan@destinationcotebasque.com'

    const merge = (s: string, r: any) => String(s ?? '')
      .replaceAll('{{prenom}}', r.prenom ?? '').replaceAll('{{nom}}', r.nom ?? '').replaceAll('{{bien}}', r.bien ?? '')

    // Corps : texte saisi → HTML simple (sobre = perso, moins "marketing"/spam) + signature.
    const SIG_URL = 'https://omuncchvypbtxkpalwcr.supabase.co/storage/v1/object/public/rapport-assets/email/signature-oihan.png'
    const wrap = (txtHtml: string) =>
      `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 20px;font-size:15px;line-height:1.7;color:#2C2416">
${txtHtml}
<div style="margin-top:24px"><img src="${SIG_URL}" alt="Oïhan — Destination Côte Basque" width="360" style="max-width:360px;width:100%;height:auto;display:block"/></div>
</div></body></html>`

    const results: any[] = []
    for (const r of recipients) {
      const to = String(r.email || '').split(/[,;]/)[0].trim()
      if (!to || !to.includes('@')) { results.push({ email: r.email, ok: false, err: 'email invalide' }); continue }
      const bodyHtml = wrap(esc(merge(body, r)).replace(/\n/g, '<br>'))
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject: merge(subject, r), html: bodyHtml }),
        })
        const d = await res.json().catch(() => ({}))
        results.push({ email: to, ok: res.ok, err: res.ok ? null : (d.message || `HTTP ${res.status}`) })
      } catch (e) {
        results.push({ email: to, ok: false, err: (e as Error).message })
      }
    }
    return json({ ok: true, sent: results.filter(r => r.ok).length, total: results.length, results })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
