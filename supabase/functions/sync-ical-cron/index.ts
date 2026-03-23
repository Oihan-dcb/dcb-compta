import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SERVICE_ROLE_KEY')!
const ICAL_FN_URL  = `${SUPABASE_URL}/functions/v1/sync-ical-ae`

Deno.serve(async (req) => {
  // Accepter GET (cron Supabase) ou POST (appel manuel)
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)

  const now    = new Date()
  const mois1  = now.toISOString().substring(0, 7)                           // mois courant
  const next   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const mois2  = next.toISOString().substring(0, 7)                          // mois suivant
  const prev   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const mois0  = prev.toISOString().substring(0, 7)                          // mois pr\u00e9c\u00e9dent
  const moisList = [mois0, mois1, mois2]

  console.log('Cron iCal - sync pour:', moisList)

  // R\u00e9cup\u00e9rer tous les AEs avec une URL iCal
  const { data: aes, error: aeErr } = await sb
    .from('auto_entrepreneur')
    .select('id, nom, prenom, ical_url')
    .not('ical_url', 'is', null)

  if (aeErr || !aes?.length) {
    console.error('Erreur AEs:', aeErr)
    return new Response(JSON.stringify({ error: 'Aucun AE avec iCal', detail: aeErr }), { status: 500 })
  }

  console.log(`${aes.length} AE(s) avec iCal URL`)

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
        results.push({ ae: `${ae.prenom} ${ae.nom}`, mois, ...data })
        console.log(`AE ${ae.nom} ${mois}:`, data)
      } catch (err: any) {
        results.push({ ae: `${ae.prenom} ${ae.nom}`, mois, error: err.message })
        console.error(`Erreur AE ${ae.nom} ${mois}:`, err.message)
      }
    }
    // Pause 500ms entre chaque AE pour \u00e9viter le throttle
    await new Promise(r => setTimeout(r, 500))
  }

  const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0)
  const totalErrors  = results.filter(r => r.error).length

  console.log(`Cron iCal termin\u00e9 - ${totalCreated} missions cr\u00e9\u00e9es, ${totalErrors} erreurs`)

  return new Response(JSON.stringify({
    ok: true,
    aes: aes.length,
    mois: moisList,
    total_created: totalCreated,
    total_errors: totalErrors,
    results,
  }), { headers: { 'Content-Type': 'application/json' } })
})
