/**
 * points-attention-avis — Edge Function Supabase (cron quotidien 7h41 UTC via pg_cron)
 *
 * « 🎯 Tes points d'attention » (07/10/2026, Oïhan) — source 3 : les commentaires voyageurs sur la
 * propreté. Un avis avec une note propreté < 5/5 (Booking /10 ramené sur 5) et un commentaire,
 * attribué à l'AE par la règle existante (_avis_proprete_attribues, migration 306 : dernière mission
 * Cleaning/Check-out du bien ≤ arrivée, fenêtre 30 j), est transformé par Haiku en 1 à 2 consignes
 * courtes et concrètes (« cheveux dans la salle de bain » → « Siphon et bonde : aucun cheveu »), ou
 * en rien si le commentaire ne concerne pas le ménage. Les consignes deviennent des points
 * d'attention de l'AE sur le bien (ae_point_attention, dédoublonnés — migration 342).
 *
 * Coûts IA maîtrisés :
 *   • UN appel par avis, jamais deux : ae_point_attention_avis mémorise chaque avis traité (ok / vide /
 *     erreur de format). Seule une erreur réseau / HTTP de l'API laisse l'avis pour le passage suivant.
 *   • MAX_APPELS par exécution (30), quel que soit le body.
 *   • Avis reçus depuis le 01/09/2026 seulement (points_attention_avis_a_traiter).
 *   • Désactivable : secret POINTS_ATTENTION_AVIS=off, ou absence d'ANTHROPIC_API_KEY.
 *
 * Confidentialité : l'AE ne voit jamais l'avis brut ni le nom du voyageur, seulement la consigne.
 * Le prompt interdit noms et citations ; le retour privé n'est envoyé qu'à l'IA, jamais affiché.
 *
 * Body : { dry_run?: boolean, limit?: number }. dry_run → renvoie les consignes générées sans rien
 * écrire (les avis restent à traiter). Appel réservé au service_role (cron).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logError } from '../_shared/logError.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MODELE       = 'claude-haiku-4-5-20251001'
const MAX_APPELS   = 30

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })

const PROMPT = (note: number, texte: string) => `Tu aides une conciergerie de locations saisonnières à former ses agents de ménage.
Voici l'avis d'un voyageur (note propreté ${note.toFixed(1)}/5) sur le logement nettoyé avant son arrivée :
"""
${texte}
"""
Transforme UNIQUEMENT ce qui relève du ménage (propreté, poussière, cheveux, taches, odeurs, linge, vaisselle,
consommables d'accueil, rangement) en 1 ou 2 consignes courtes et concrètes, en français, à l'attention de l'agent
de ménage, formulées comme un point de contrôle positif (ex. « cheveux dans la salle de bain » → « Siphon et bonde : aucun cheveu » ;
« verres sales » → « Verres et tasses : relaver ceux qui ont des traces »).
Règles : 70 caractères maximum par consigne ; aucun nom de personne ; aucune citation de l'avis ; pas de reproche
ni de « le voyageur a dit » ; ignore ce qui ne dépend pas du ménage (bruit, emplacement, équipement en panne,
communication, prix, travaux, parties communes de l'immeuble, tâches demandées aux voyageurs au départ comme sortir
les poubelles ou un forfait ménage contesté). Écris tout en français, sans aucun mot étranger. Dans le doute, liste vide.
Réponds UNIQUEMENT avec ce JSON : {"consignes": ["…"]}`

async function genererConsignes(apiKey: string, note: number, texte: string): Promise<{ ok: true; consignes: string[] } | { ok: false; reessayer: boolean; erreur: string }> {
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELE, max_tokens: 200, messages: [{ role: 'user', content: PROMPT(note, texte) }] }),
    })
  } catch (e) {
    return { ok: false, reessayer: true, erreur: 'réseau : ' + (e as Error).message }
  }
  if (!res.ok) return { ok: false, reessayer: true, erreur: `HTTP ${res.status} : ${(await res.text()).slice(0, 200)}` }
  const d = await res.json()
  const brut: string = d.content?.[0]?.text ?? ''
  const m = brut.match(/\{[\s\S]*\}/)
  try {
    const parsed = JSON.parse(m ? m[0] : brut)
    const consignes = (Array.isArray(parsed.consignes) ? parsed.consignes : [])
      .filter((c: unknown) => typeof c === 'string')
      .map((c: string) => c.trim().replace(/^["«\s]+|["»\s]+$/g, ''))
      .filter((c: string) => c.length >= 3)
      .map((c: string) => (c.length > 90 ? c.slice(0, 87) + '…' : c))
      .slice(0, 2)
    return { ok: true, consignes }
  } catch {
    return { ok: false, reessayer: false, erreur: 'réponse non JSON : ' + brut.slice(0, 200) }
  }
}

// Réservé au service_role (cron pg_cron, clé du vault). verify_jwt (défaut) fait vérifier la signature
// du JWT par la passerelle ; on contrôle ensuite le rôle porté par le jeton.
function estServiceRole(req: Request): boolean {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  if (SERVICE_KEY && token === SERVICE_KEY) return true
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4))).role === 'service_role'
  } catch { return false }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (!estServiceRole(req)) return json({ error: 'acces_refuse' }, 401)

  let body: { dry_run?: boolean; limit?: number } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true
  const limit = Math.max(1, Math.min(Number(body.limit) || MAX_APPELS, MAX_APPELS))

  if ((Deno.env.get('POINTS_ATTENTION_AVIS') || '').toLowerCase() === 'off') return json({ ok: true, desactive: 'POINTS_ATTENTION_AVIS=off' })
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) return json({ ok: true, desactive: 'ANTHROPIC_API_KEY absente' })

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: avis, error } = await supabase.rpc('points_attention_avis_a_traiter', { p_limit: limit })
  if (error) return json({ error: error.message }, 500)

  const resultats: any[] = []
  let appels = 0, points = 0, erreurs = 0
  for (const a of avis || []) {
    if (appels >= MAX_APPELS) break
    const texte = [a.comment, a.private_feedback].filter(Boolean).join('\n\n').slice(0, 2000)
    appels++
    const r = await genererConsignes(apiKey, Number(a.note), texte)
    if (!r.ok) {
      erreurs++
      resultats.push({ review_id: a.review_id, erreur: r.erreur })
      if (!dryRun && !r.reessayer) {
        await supabase.rpc('points_attention_avis_enregistrer', { p_review_id: a.review_id, p_ae_id: a.ae_id, p_bien_id: a.bien_id, p_consignes: [], p_statut: 'erreur', p_modele: MODELE })
      }
      continue
    }
    const ligne: any = { review_id: a.review_id, note: Number(a.note), consignes: r.consignes }
    if (dryRun) ligne.commentaire = texte.slice(0, 300) // dry_run réservé au service_role : contrôle humain du résultat
    if (!dryRun) {
      const { data: n, error: e } = await supabase.rpc('points_attention_avis_enregistrer', {
        p_review_id: a.review_id, p_ae_id: a.ae_id, p_bien_id: a.bien_id,
        p_consignes: r.consignes, p_statut: r.consignes.length ? 'ok' : 'vide', p_modele: MODELE,
      })
      if (e) { erreurs++; ligne.erreur = e.message } else { points += Number(n) || 0; ligne.points = n }
    }
    resultats.push(ligne)
  }

  if (erreurs && !dryRun) {
    await logError({ source: 'edge_points-attention-avis', level: 'warn', message: `${erreurs} avis en erreur`, context: { resultats: resultats.filter(r => r.erreur) } })
  }
  return json({ ok: true, dry_run: dryRun, avis: (avis || []).length, appels, points, erreurs, resultats })
})
