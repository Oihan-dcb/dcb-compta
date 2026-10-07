// hospitable-etat-biens — contrôle quotidien de l'état Hospitable de chaque bien (08/10/2026, Oïhan).
// Contexte : 56 biens avaient été mis en sourdine (muted) dans Hospitable pour alléger le planning → l'API
// répond 422 et plus rien ne se synchronise (réservations, fiche, équipements) pendant une semaine sans que
// personne ne le voie. On masque désormais chez nous (bien.statut_location, migration 351).
// Pour chaque bien ayant un hospitable_id :
//   1. état : actif (200) / muted (422) / introuvable (404) → bien.hospitable_etat + hospitable_etat_at ;
//   2. étiquettes Hospitable (multi-calendrier filtrable) : ajoute « En location » (statut saisonnier) ou
//      « Étudiant » (lld) si absente. L'API ne sait qu'AJOUTER : une étiquette devenue fausse (ex. « En location »
//      sur un bien passé en location étudiante) est signalée dans le mail, à retirer à la main ;
//   3. alerte mail au bureau quand un bien devient muted/introuvable ALORS QU'IL A DES RÉSERVATIONS À VENIR
//      (leurs modifications / annulations ne seraient plus synchronisées) — changement d'état seulement.
//      La sourdine elle-même est voulue (Oïhan 08/10 : « muté = plus réservable en ce moment ») : le bien
//      passe automatiquement hors location (maj_statut_location, migration 353), sans alerte.
//      Aussi : étiquette devenue fausse.
// Auth : service_role (cron pg_cron 7h40 Paris). ?dry=1 : ne modifie rien, renvoie le plan.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const HOSP = 'https://public.api.hospitable.com/v2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN = Deno.env.get('HOSPITABLE_TOKEN') ?? ''
const DEST = ['oihan@destinationcotebasque.com']
const ETIQUETTE: Record<string, string> = { saisonnier: 'En location', lld: 'Étudiant' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let role = ''
  try { role = JSON.parse(atob(auth.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { /* */ }
  if (role !== 'service_role') return json({ error: 'Non autorisé' }, 401)
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const h = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' }

  const { data: biens, error } = await sb.from('bien')
    .select('id, code, agence, hospitable_id, statut_location, hospitable_etat, hospitable_tag_a_retirer')
    .not('hospitable_id', 'is', null).not('hospitable_id', 'like', 'manual-%')
  if (error) return json({ error: error.message }, 500)

  const nouveauxMuets: any[] = [], tagsFaux: any[] = [], tagues: any[] = [], erreurs: any[] = []
  for (const b of biens || []) {
    const r = await fetch(`${HOSP}/properties/${b.hospitable_id}`, { headers: h })
    const etat = r.status === 200 ? 'actif' : r.status === 422 ? 'muted' : r.status === 404 ? 'introuvable' : 'erreur_' + r.status
    const p = r.status === 200 ? (await r.json().catch(() => ({})))?.data : null
    const tags: string[] = p?.tags || []
    // Bien en location dont l'identifiant Hospitable n'existe plus (404) : fiche rattachée à une ancienne annonce
    // (cas BORDEZIA 08/10/2026 → plus de tarifs ni de réservations) — alerte au premier constat.
    if (etat === 'introuvable' && b.statut_location === 'saisonnier' && b.hospitable_etat !== etat) nouveauxMuets.push({ ...b, etat, a_venir: 0, introuvable: true })
    else if (etat !== 'actif' && b.hospitable_etat !== etat) {
      const { count } = await sb.from('reservation').select('id', { count: 'exact', head: true })
        .eq('bien_id', b.id).eq('final_status', 'accepted').gte('departure_date', new Date().toISOString().slice(0, 10))
      if (count) nouveauxMuets.push({ ...b, etat, a_venir: count })
    }
    let tagARetirer = false
    if (p) {
      const voulu = ETIQUETTE[b.statut_location]
      if (voulu && !tags.includes(voulu)) {
        if (!dry) {
          const t = await fetch(`${HOSP}/properties/${b.hospitable_id}/tags`, { method: 'POST', headers: h, body: JSON.stringify({ tags: [voulu] }) })
          if (t.ok) tagues.push({ code: b.code, tag: voulu }); else erreurs.push({ code: b.code, tag: voulu, status: t.status, detail: (await t.text()).slice(0, 200) })
        } else tagues.push({ code: b.code, tag: voulu, dry: true })
      }
      const faux = Object.entries(ETIQUETTE).filter(([st, tg]) => st !== b.statut_location && tags.includes(tg)).map(([, tg]) => tg)
      tagARetirer = faux.length > 0
      if (tagARetirer && !b.hospitable_tag_a_retirer) tagsFaux.push({ ...b, faux })
    }
    if (!dry) await sb.from('bien').update({ hospitable_etat: etat, hospitable_etat_at: new Date().toISOString(), hospitable_tag_a_retirer: tagARetirer }).eq('id', b.id)
  }

  if (!dry && (nouveauxMuets.length || tagsFaux.length)) {
    const libSt = (s: string) => s === 'lld' ? 'location étudiante' : 'en location'
    const html = `<div style="font-family:Arial,sans-serif;color:#2C2416;font-size:14px">
      ${nouveauxMuets.length ? `<h3 style="color:#B91C1C">🔇 ${nouveauxMuets.length} bien(s) à vérifier dans Hospitable</h3>
      <p>Hospitable ne rend plus ces biens à l'API : une modification ou une annulation de ces réservations n'arrivera plus chez nous (contrat, ménage, compta).</p>
      <ul>${nouveauxMuets.map(b => b.introuvable ? `<li><b>${b.code}</b> (${b.agence}) — en location chez nous mais <b>annonce Hospitable introuvable</b> : identifiant à rattacher (PowerHouse → Biens → 🔄 Sync Hospitable → Rattacher)</li>` : `<li><b>${b.code}</b> (${b.agence}) — ${b.a_venir} réservation(s) à venir — ${b.etat === 'muted' ? 'en sourdine' : b.etat}</li>`).join('')}</ul>
      <p>➡️ Le réactiver jusqu'au départ du dernier voyageur, ou surveiller ces séjours à la main.</p>` : ''}
      ${tagsFaux.length ? `<h3>🏷 Étiquette Hospitable à retirer à la main</h3><ul>${tagsFaux.map(b => `<li><b>${b.code}</b> : retirer « ${b.faux.join(' », « ')} » (statut actuel : ${b.statut_location === 'hors_location' ? 'hors location' : libSt(b.statut_location)})</li>`).join('')}</ul>
      <p>L'API Hospitable sait ajouter une étiquette mais pas l'enlever.</p>` : ''}
    </div>`
    await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: DEST, subject: nouveauxMuets.length ? `🔇 ${nouveauxMuets.length} bien(s) en sourdine avec des réservations à venir` : `🏷 Étiquettes Hospitable à corriger`, html }),
    })
  }
  return json({ ok: true, dry, controles: (biens || []).length, nouveaux_muets: nouveauxMuets.map(b => b.code), tags_ajoutes: tagues, tags_a_retirer: tagsFaux.map(b => ({ code: b.code, faux: b.faux })), erreurs })
})
