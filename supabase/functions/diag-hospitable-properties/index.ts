// diag-hospitable-properties — DIAGNOSTIC LECTURE SEULE (08/10/2026) : quelles propriétés la clé
// HOSPITABLE_TOKEN voit-elle, et que renvoie l'API pour une liste d'ids de biens (?ids=a,b,c) ?
// Auth : service_role uniquement. N'écrit rien.
const HOSP = 'https://public.api.hospitable.com/v2'
Deno.serve(async (req) => {
  // verify_jwt actif (signature vérifiée par la passerelle) → on exige le rôle service_role
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let role = ''
  try { role = JSON.parse(atob(auth.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { /* */ }
  if (role !== 'service_role') return new Response('Non autorisé', { status: 401 })
  const tok = Deno.env.get('HOSPITABLE_TOKEN')!
  const h = { Authorization: `Bearer ${tok}`, Accept: 'application/json' }
  const url = new URL(req.url)
  const props: any[] = []
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`${HOSP}/properties?per_page=100&page=${page}`, { headers: h })
    const j = await r.json().catch(() => ({}))
    props.push(...(j.data || []).map((p: any) => ({ id: p.id, name: p.name, listed: p.listed })))
    if (!j.meta || page >= j.meta.last_page) break
  }
  const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean)
  const details: any[] = []
  for (const id of ids) {
    const r = await fetch(`${HOSP}/properties/${id}`, { headers: h })
    const t = await r.text()
    details.push({ id, status: r.status, extrait: t.slice(0, 200) })
  }
  const user = await fetch(`${HOSP}/user`, { headers: h }).then(r => r.json()).catch(() => null)
  return Response.json({ compte: user?.data ? { email: user.data.email, name: user.data.name } : null, nb: props.length, props, details })
})
