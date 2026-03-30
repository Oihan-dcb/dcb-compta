import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { prompt } = await req.json()
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })
  return new Response(
    JSON.stringify({ text: msg.content[0].text }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
