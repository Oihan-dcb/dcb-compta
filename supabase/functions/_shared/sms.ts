// _shared/sms.ts — Envoi de SMS par le prestataire choisi (Edge Functions Deno).
// Rapatriement vers des prestataires français, préparé le 17/10/2026. Même logique que dcb-planning/api/_sms.js.
//
// SMS_PROVIDER (secret Supabase) :
//   - "twilio" (DÉFAUT, comportement inchangé) : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER ;
//   - "ovh" : OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY, OVH_SMS_SERVICE, OVH_SMS_SENDER (facultatif),
//             OVH_API_ENDPOINT (défaut https://eu.api.ovh.com/1.0).
// SMS_DRY_RUN=1 : journalise sans envoyer.
// twilio-backfill (relecture de l'historique Twilio) reste spécifique à Twilio et n'utilise pas ce module.

const env = (k: string) => Deno.env.get(k) || ''

export function smsProvider(): string {
  const p = env('SMS_PROVIDER').trim().toLowerCase() || 'twilio'
  return ['twilio', 'ovh'].includes(p) ? p : 'twilio'
}

export function smsConfigure(): boolean {
  if (smsProvider() === 'ovh') return !!(env('OVH_APP_KEY') && env('OVH_APP_SECRET') && env('OVH_CONSUMER_KEY') && env('OVH_SMS_SERVICE'))
  return !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM_NUMBER'))
}

async function sha1Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Résultat simple { ok, sid?, error? } (forme déjà utilisée par relance-loyer).
export async function envoyerSms(to: string, texte: string, opts: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<{ ok: boolean; sid?: string | null; error?: string }> {
  const f = opts.fetchImpl || fetch
  const provider = smsProvider()
  if (env('SMS_DRY_RUN') === '1') {
    console.log(`[sms] DRY RUN (${provider}) → ${String(to).slice(0, 6)}… : ${String(texte).slice(0, 60)}`)
    return { ok: true, sid: 'dry-run' }
  }
  try {
    if (provider === 'ovh') {
      const base = (env('OVH_API_ENDPOINT') || 'https://eu.api.ovh.com/1.0').replace(/\/$/, '')
      const url = `${base}/sms/${encodeURIComponent(env('OVH_SMS_SERVICE'))}/jobs`
      const corps: Record<string, unknown> = { message: texte, receivers: [String(to).trim()], charset: 'UTF-8', priority: 'high', noStopClause: true }
      if (env('OVH_SMS_SENDER')) { corps.sender = env('OVH_SMS_SENDER'); corps.senderForResponse = false } else corps.senderForResponse = true
      const body = JSON.stringify(corps)
      const ts = String(opts.now ?? Math.floor(Date.now() / 1000))
      const sig = '$1$' + await sha1Hex([env('OVH_APP_SECRET'), env('OVH_CONSUMER_KEY'), 'POST', url, body, ts].join('+'))
      const r = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ovh-Application': env('OVH_APP_KEY'), 'X-Ovh-Consumer': env('OVH_CONSUMER_KEY'), 'X-Ovh-Timestamp': ts, 'X-Ovh-Signature': sig },
        body,
      })
      const d: any = await r.json().catch(() => ({}))
      if (r.ok && Array.isArray(d.validReceivers) && d.validReceivers.length) return { ok: true, sid: d.ids?.[0] != null ? String(d.ids[0]) : null }
      return { ok: false, error: d.message || (d.invalidReceivers?.length ? 'Numéro refusé par OVH' : `OVH ${r.status}`) }
    }
    const sid = env('TWILIO_ACCOUNT_SID')
    const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: env('TWILIO_FROM_NUMBER'), To: to, Body: texte }).toString(),
    })
    const data: any = await res.json()
    if (res.ok) return { ok: true, sid: data.sid }
    return { ok: false, error: data.message || JSON.stringify(data) }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}
