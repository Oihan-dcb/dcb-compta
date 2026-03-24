import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ICAL_FN_URL   = `${SUPABASE_URL}/functions/v1/sync-ical-ae`

Deno.serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  const now   = new Date()
  const mois1 = now.toISOString().substring(0, 7)
  const mois2 = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().substring(0, 7)
  const mois0 = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().substring(0, 7)
  const moisList = [mois0, mois1, mois2]

  console.log('Cron iCal - mois:', moisList)

  const { data: aes, error } = await sb
    .from('auto_entrepreneur')
    .select('id, nom, prenom, ical_url')
    .not('ical_url', 'is', null)

  if (error || !aes?.length) {
    console.error('Erreur AEs:', error)
    return new Response(JSON.stringify({ error: 'Aucun AE' }), { status: 500 })
  }

  const results: any[] = []

  for (const ae of aes) {
    for (const mois of moisList) {
      try {
        const resp = await fetch(ICAL_FN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ ae_id: ae.id, mois }),
        })
        const data = await resp.json()
        results.push({ ae: ae.nom, mois, ...data })
        console.log(`${ae.nom} ${mois}:`, JSON.stringify(data))
      } catch (err: any) {
        results.push({ ae: ae.nom, mois, error: err.message })
        console.error(`Erreur ${ae.nom} ${mois}:`, err.message)
      }
    }
    await new Promise(r => setTimeout(r, 300))
  }

  const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0)
  console.log('Termin\u00e9 -', totalCreated, 'missions cr\u00e9\u00e9es')

  return new Response(JSON.stringify({
    ok: true, aes: aes.length, mois: moisList,
    total_created: totalCreated,
    results,
  }), { headers: { 'Content-Type': 'application/json' } })
})
