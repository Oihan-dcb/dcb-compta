// _shared/mail.ts — Envoi d'e-mails par le prestataire choisi (Edge Functions Deno).
// Rapatriement vers des prestataires français, préparé le 17/10/2026. Même logique que dcb-planning/api/_mail.js.
//
// Message au FORMAT RESEND : { from, to, cc?, bcc?, reply_to?, subject, html?, text?, attachments?: [{ filename, content(base64) }] }
// MAIL_PROVIDER (secret Supabase) :
//   - "resend" (DÉFAUT, comportement inchangé) : RESEND_API_KEY ;
//   - "brevo"  : BREVO_API_KEY (domaine d'envoi authentifié chez Brevo) ;
//   - "ovh_smtp" : OVH_SMTP_HOST, OVH_SMTP_PORT (465 conseillé : Supabase bloque les ports sortants 25 et 587),
//                  OVH_SMTP_USER, OVH_SMTP_PASS, OVH_SMTP_FROM (adresse imposée par OVH, nom affiché conservé).
// MAIL_DRY_RUN=1 : journalise sans envoyer.
// Retourne une Response (ok, status, json() → { id } ou { message }), comme l'appel Resend d'origine.

type Msg = Record<string, any>

const env = (k: string) => Deno.env.get(k) || ''

export function mailProvider(): string {
  const p = env('MAIL_PROVIDER').trim().toLowerCase() || 'resend'
  return ['resend', 'brevo', 'ovh_smtp'].includes(p) ? p : 'resend'
}

export function mailConfigure(): boolean {
  switch (mailProvider()) {
    case 'brevo': return !!env('BREVO_API_KEY')
    case 'ovh_smtp': return !!(env('OVH_SMTP_HOST') && env('OVH_SMTP_USER') && env('OVH_SMTP_PASS'))
    default: return !!env('RESEND_API_KEY')
  }
}

export function parseAdresse(s: any): { name?: string; email: string } | null {
  if (s && typeof s === 'object') return s.email ? { email: s.email, ...(s.name ? { name: s.name } : {}) } : null
  const t = String(s || '').trim()
  if (!t) return null
  const m = t.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>]+)\s*>\s*$/)
  if (m) return m[1].trim() ? { name: m[1].trim(), email: m[2].trim() } : { email: m[2].trim() }
  return { email: t }
}
const liste = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]).map(parseAdresse).filter(Boolean) as { name?: string; email: string }[]
const formatAdresse = (a: { name?: string; email: string }) => (a.name ? `"${a.name.replace(/"/g, '')}" <${a.email}>` : a.email)
const reponse = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export function versBrevo(m: Msg) {
  const from = parseAdresse(m.from) || { email: '' }
  const corps: Msg = { sender: from.name ? { name: from.name, email: from.email } : { email: from.email }, to: liste(m.to), subject: m.subject }
  const cc = liste(m.cc); if (cc.length) corps.cc = cc
  const bcc = liste(m.bcc); if (bcc.length) corps.bcc = bcc
  const rt = liste(m.reply_to); if (rt.length) corps.replyTo = rt[0]
  if (m.html) corps.htmlContent = m.html
  if (m.text) corps.textContent = m.text
  if (Array.isArray(m.attachments) && m.attachments.length) {
    corps.attachment = m.attachments.map((a: any) => (a.content != null ? { name: a.filename, content: String(a.content) } : { name: a.filename, url: a.path }))
  }
  if (m.headers && typeof m.headers === 'object') corps.headers = m.headers
  return corps
}

export async function envoyerMail(m: Msg, opts: { fetchImpl?: typeof fetch } = {}): Promise<Response> {
  const f = opts.fetchImpl || fetch
  const provider = mailProvider()
  if (env('MAIL_DRY_RUN') === '1') {
    console.log(`[mail] DRY RUN (${provider}) → ${JSON.stringify(m.to)} : ${m.subject}`)
    return reponse(200, { id: 'dry-run', provider })
  }
  if (provider === 'brevo') {
    const r = await f('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(versBrevo(m)),
    })
    const d: any = await r.json().catch(() => ({}))
    if (r.ok) return reponse(200, { id: d.messageId || null, provider })
    return reponse(r.status, { name: d.code || 'brevo_error', message: d.message || `Brevo ${r.status}`, provider })
  }
  if (provider === 'ovh_smtp') {
    try {
      const { default: nodemailer } = await import('npm:nodemailer@6.9.14')
      const port = Number(env('OVH_SMTP_PORT') || 465)
      const t = nodemailer.createTransport({ host: env('OVH_SMTP_HOST'), port, secure: port === 465, auth: { user: env('OVH_SMTP_USER'), pass: env('OVH_SMTP_PASS') } })
      const from = parseAdresse(m.from) || { email: '' }
      const forcer = !!env('OVH_SMTP_FROM') && env('OVH_SMTP_FORCE_FROM') !== '0'
      const fromFinal = forcer ? { name: from.name, email: parseAdresse(env('OVH_SMTP_FROM'))!.email } : from
      let rt = liste(m.reply_to)
      if (!rt.length && forcer && from.email && from.email !== fromFinal.email) rt = [from]
      const info = await t.sendMail({
        from: formatAdresse(fromFinal), to: liste(m.to).map(formatAdresse), subject: m.subject,
        ...(liste(m.cc).length ? { cc: liste(m.cc).map(formatAdresse) } : {}),
        ...(liste(m.bcc).length ? { bcc: liste(m.bcc).map(formatAdresse) } : {}),
        ...(rt.length ? { replyTo: rt.map(formatAdresse) } : {}),
        ...(m.html ? { html: m.html } : {}), ...(m.text ? { text: m.text } : {}),
        ...(Array.isArray(m.attachments) && m.attachments.length
          ? { attachments: m.attachments.map((a: any) => (a.content != null ? { filename: a.filename, content: String(a.content), encoding: 'base64' } : { filename: a.filename, path: a.path })) }
          : {}),
      })
      return reponse(200, { id: info.messageId || null, provider })
    } catch (e: any) {
      return reponse(Number(e?.responseCode) >= 400 ? 502 : 500, { name: e?.code || 'smtp_error', message: e?.message || String(e), provider })
    }
  }
  return f('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(m),
  })
}
