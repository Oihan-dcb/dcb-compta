/**
 * alerte-fraicheur-banque — Edge Function Supabase (cron quotidien 8h49 UTC via pg_cron)
 *
 * Garde-fou I-152 (audit segment Banque, 24/09/2026) : la connexion bancaire Pennylane du compte
 * CAISSE EPARGNE COURANT est tombée côté Pennylane (dernière transaction le 10/07/2026) et
 * PERSONNE ne l'a vu pendant 2 mois et demi — le cron affichait « 196 importées » chaque nuit
 * (compteur faux, corrigé dans importBanque.js). Conséquences : paiements d'honoraires/débours des
 * propriétaires jamais rapprochés, relances envoyées à des propriétaires qui avaient payé.
 *
 * Ce contrôle regarde, pour chaque compte suivi, la date de la DERNIÈRE opération en base et
 * alerte si elle dépasse le seuil. Lecture seule (écritures : alerte_etat + journal_ops).
 *
 * Depuis l'audit des mails (09/10/2026) : plus de mail direct. Les comptes muets sont publiés dans
 * alerte_etat (source 'fraicheur_banque', une ligne par compte et par agence, marquée urgente :
 * remonte aussi le week-end) et apparaissent dans le Point du matin de l'agence du compte.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { COMPTES_SUIVIS, etatCompte } from '../_shared/fraicheurBanque.ts'
import { signaler, fmtDateFr, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SOURCE = 'fraicheur_banque'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true

  const etat = []
  for (const c of COMPTES_SUIVIS) {
    try { etat.push(await etatCompte(supabase, c)) }
    catch (e) { return json({ error: (e as Error).message }, 500) }
  }
  const muets = etat.filter(e => e.muet)

  if (!dryRun) {
    for (const agence of [...new Set(COMPTES_SUIVIS.map(c => c.agence))]) {
      const items: ItemAlerte[] = muets.filter(m => m.agence === agence).map(m => ({
        cle: `compte:${m.source}`,
        libelle: `Relevé bancaire muet — ${m.label} : dernière opération ${m.derniere ? `${fmtDateFr(m.derniere)} (il y a ${m.age} j, seuil ${m.jours} j)` : 'aucune'}. ${m.action} Tant qu'il est muet, rien n'est rapproché et les relances sont suspendues.`,
        detail: { source: m.source, derniere: m.derniere, urgent: true },
      }))
      await signaler(supabase, SOURCE, agence, items)
    }
    if (muets.length) await supabase.from('journal_ops').insert({
      categorie: 'banque', action: 'alerte_fraicheur_banque', source: 'cron', statut: 'warning',
      message: `${muets.length} compte(s) muet(s) : ${muets.map(m => `${m.label} (dernière op. ${m.derniere ?? 'aucune'})`).join(' ; ')} — publié pour le Point du matin`,
    })
  }
  return json({ dry_run: dryRun, muets: muets.length, etat })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
