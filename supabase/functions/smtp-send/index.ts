import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, cc, subject, html, attachments = [] } = await req.json()

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: 'Missing to/subject/html' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY non configuré' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const toArray = Array.isArray(to)
      // Sépare aussi sur ',' : 7 fiches proprio stockent plusieurs adresses dans un seul champ
      // ("a@x.fr,b@y.com") et les appelants passent souvent [proprio.email] (24/09/2026).
      ? to.flatMap((e: string) => (typeof e === 'string' ? e.split(/[,;]/) : [e]))
          .map((e: string) => (e || '').trim()).filter((e: string) => e.includes('@'))
      : to.split(/[,;]/).map((e: string) => e.trim()).filter((e: string) => e.includes('@'))

    // CC : uniquement celui demandé par l'appelant. Jusqu'au 09/10/2026, oihan@ était ajouté en copie
    // de TOUT envoi (≈ 135 copies/mois de relances, rapports, quittances… sans action attendue) —
    // supprimé (audit des mails) : chaque envoi reste tracé dans journal_ops / facture_evoliz.
    const ccFromPayload: string[] = cc
      ? (Array.isArray(cc) ? cc : String(cc).split(/[,;]/)).map((e: string) => (e || '').trim()).filter((e: string) => e.includes('@'))
      : []
    const toLower = new Set(toArray.map((e: string) => e.toLowerCase()))
    const ccArray = [...new Set(ccFromPayload)].filter(e => !toLower.has(e.toLowerCase()))

    const payload: any = {
      from: 'Destination Cote Basque <rapports@mail.destinationcotebasque.com>',
      to: toArray,
      subject,
      html,
    }
    if (ccArray.length) payload.cc = ccArray

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((a: any) => ({
        filename: a.filename,
        content: a.content_base64,
      }))
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: data.message || 'Erreur Resend', detail: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ ok: true, id: data.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
