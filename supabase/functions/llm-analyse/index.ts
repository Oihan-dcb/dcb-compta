const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { prompt, system } = await req.json()

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'prompt requis' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (prompt.length > 20000) {
    return new Response(JSON.stringify({ error: 'prompt trop long (max 20000)' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (system !== undefined && (typeof system !== 'string' || system.length > 4000)) {
    return new Response(JSON.stringify({ error: 'system invalide (string, max 4000)' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

  const body: Record<string, unknown> = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  }
  if (system) body.system = system

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    return new Response(JSON.stringify({ error: err }), {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const json = await res.json()
  const text = json.content?.[0]?.text ?? ''

  return new Response(
    JSON.stringify({ text }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
