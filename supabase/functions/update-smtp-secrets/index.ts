import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const MGMT_TOKEN = Deno.env.get('SUPABASE_MANAGEMENT_TOKEN')
    if (!MGMT_TOKEN) throw new Error('SUPABASE_MANAGEMENT_TOKEN non configuré')

    const PROJECT_REF = 'omuncchvypbtxkpalwcr'
    const body = await req.json()

    const fields: { name: string; value: string }[] = []
    if (body.host) fields.push({ name: 'SMTP_HOST', value: body.host })
    if (body.port) fields.push({ name: 'SMTP_PORT', value: body.port })
    if (body.user) fields.push({ name: 'SMTP_USER', value: body.user })
    if (body.from) fields.push({ name: 'SMTP_FROM', value: body.from })
    if (body.pass) fields.push({ name: 'SMTP_PASS', value: body.pass })

    if (fields.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Aucun champ à mettre à jour' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      }
    )

    if (!res.ok) throw new Error('Supabase API error: ' + res.status)

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
