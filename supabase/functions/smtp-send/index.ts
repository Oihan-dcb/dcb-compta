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
      ? to
      : to.split(',').map((e: string) => e.trim()).filter((e: string) => e.includes('@'))

    // CC : oihan@ toujours en copie, fusionné avec cc éventuel du payload
    const CC_FIXED = 'oihan@destinationcotebasque.com'
    const ccFromPayload = cc
      ? (Array.isArray(cc) ? cc : cc.split(',').map((e: string) => e.trim()).filter((e: string) => e.includes('@')))
      : []
    const ccArray = [...new Set([CC_FIXED, ...ccFromPayload])]

    const payload: any = {
      from: 'Destination Cote Basque <rapports@mail.destinationcotebasque.com>',
      to: toArray,
      cc: ccArray,
      subject,
      html,
    }

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
