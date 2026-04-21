// parse-invoice : reçoit un PDF ou image en base64, extrait les infos de la facture via Claude
// Retourne : { fournisseur, montant_ttc, montant_ht, date_facture, numero_facture, type_paiement }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { file_base64, media_type } = await req.json()
  // media_type : 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

  if (!file_base64 || !media_type) {
    return json({ error: 'file_base64 et media_type requis' }, 400)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY non configuré' }, 500)

  const isPdf = media_type === 'application/pdf'

  const content = isPdf
    ? [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file_base64 },
        },
        {
          type: 'text',
          text: PROMPT,
        },
      ]
    : [
        {
          type: 'image',
          source: { type: 'base64', media_type, data: file_base64 },
        },
        {
          type: 'text',
          text: PROMPT,
        },
      ]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return json({ error: err }, 500)
  }

  const data = await res.json()
  const text = data.content?.[0]?.text?.trim() || ''

  try {
    // Extraire le JSON même s'il y a du texte autour
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] || text)
    return json({ ok: true, ...parsed })
  } catch {
    return json({ ok: false, raw: text, error: 'Parse JSON échoué' }, 200)
  }
})

const PROMPT = `Analyse cette facture et extrais les informations en JSON strict, sans commentaire autour :

{
  "fournisseur": "nom de l'entreprise qui émet la facture",
  "montant_ttc": 99.99,
  "montant_ht": 83.32,
  "tva": 16.67,
  "date_facture": "YYYY-MM-DD",
  "numero_facture": "FAC-2026-001",
  "type_paiement": "virement"
}

Règles :
- montant_ttc : montant total TTC en euros (nombre décimal)
- montant_ht : montant HT si présent, sinon null
- tva : montant TVA si présent, sinon null
- date_facture : date de la facture au format YYYY-MM-DD, sinon null
- numero_facture : numéro de facture si présent, sinon null
- type_paiement : "virement" | "cb" | "prelevement" | "cheque" | null selon ce qui est mentionné
- Si une valeur n'est pas lisible, mets null

Réponds UNIQUEMENT avec le JSON, rien d'autre.`

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
