/**
 * alerte-changement-post-facture — Edge Function Supabase (cron quotidien 8h45/8h47 UTC via pg_cron)
 *
 * Garde-fou I-144 (incident VIKY/HM8SZAKKMK, 24/09/2026) : une résa de juillet a vu son revenu
 * baisser de 1500€ (résolution Airbnb, remboursement partiel voyageur) APRÈS la génération de la
 * facture honoraires de juillet. La ventilation a été recalculée, mais la facture est restée sur
 * l'ancien montant (HON +375€ TTC) sans que rien ne le signale. Pour une facture déjà envoyée à
 * Evoliz c'est pire : la ventilation est verrouillée (STATUTS_VERROU_FACTURE), l'écart ne remonte
 * donc nulle part.
 *
 * Source : table reservation_changement_post_facture, alimentée par deux triggers — 
 * trg_trace_changement_post_facture (migration 260 : fin_revenue / final_status d'une résa) et
 * trg_trace_ajustement_post_facture (migration 261 : ajustement Hospitable qualifié) — dès que la
 * facture honoraires du mois existe déjà.
 *
 * Comportement :
 * • Résolution automatique : facture encore brouillon/validée dont les lignes ont été recréées
 *   APRÈS le changement (= brouillon régénéré depuis Facturation) → resolu_at posé.
 * • Mail récap des changements pas encore signalés (alerte_envoyee_at NULL), un seul mail par
 *   changement — pas de relance quotidienne.
 * • Facture envoyée à Evoliz / payée : jamais résolue automatiquement (avoir ou régularisation
 *   M+1 = décision humaine) ; après traitement : resolu_at + resolu_note à poser à la main.
 * • dry_run supporté. Seules écritures : alerte_envoyee_at / resolu_at + journal_ops + alerte_etat.
 *
 * Audit des alertes du 09/10/2026 : 54 lignes ouvertes dont ~35 sans effet financier (demande
 * 'not accepted' → 'expired'/'declined', allers-retours accepted ↔ deleted de la synchro, écart de
 * 0,58 €). Le trigger ne trace plus ces cas (migration 371) ; ici, une résa dont le PREMIER statut
 * et le DERNIER statut sont de la même famille et dont le revenu net n'a pas bougé (< 1 €) est
 * close automatiquement (« aller-retour sans effet »).
 * Plus de mail : publication dans alerte_etat (sources 'changement_post_facture' et
 * 'ajustement_a_qualifier') → Point du matin (nouveau en tête, rappels J+3/J+7).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signaler, fmtEur, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STATUTS_REGENERABLES = ['brouillon', 'valide']
const famille = (s: string | null) => s === 'accepted' ? 'accepted' : s === 'cancelled' ? 'cancelled' : 'nul'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  let body: { dry_run?: boolean; agence?: string } = {}
  try { body = await req.json() } catch { /* GET accepté */ }
  const dryRun = body.dry_run === true
  const AGENCE = body.agence || 'dcb'

  const { data: rows, error } = await supabase
    .from('reservation_changement_post_facture')
    .select('id, reservation_id, bien_id, proprietaire_id, mois_comptable, facture_id, facture_statut, ancien_fin_revenue, nouveau_fin_revenue, ancien_statut, nouveau_statut, motif, detecte_at, alerte_envoyee_at, reservation:reservation_id(code, guest_name, platform), bien:bien_id(code, hospitable_name), facture:facture_id(statut)')
    .eq('agence', AGENCE)
    .is('resolu_at', null)
    .order('detecte_at')
  if (error) return json({ error: error.message }, 500)

  // Ajustements Hospitable 'a_qualifier' depuis > 7 jours (I-151), 12 derniers mois comptables
  const limite = new Date(Date.now() - 7 * 86400000).toISOString()
  const d12 = new Date(); d12.setUTCMonth(d12.getUTCMonth() - 12)
  const { data: aq } = await supabase.from('reservation_ajustement')
    .select('id, montant, label, created_at, mois_comptable, reservation:reservation_id!inner(code, bien:bien_id!inner(code, hospitable_name, agence))')
    .eq('statut', 'a_qualifier').lt('created_at', limite).gte('mois_comptable', d12.toISOString().slice(0, 7))
    .eq('reservation.bien.agence', AGENCE)
    .order('created_at')

  // Lignes de facture (date de (re)génération)
  const factureIds = [...new Set((rows || []).map(r => r.facture_id).filter(Boolean))] as string[]
  const genereeAt = new Map<string, string>()
  if (factureIds.length) {
    const { data: lf } = await supabase.from('facture_evoliz_ligne').select('facture_id, created_at').in('facture_id', factureIds)
    for (const l of lf || []) if (l.created_at > (genereeAt.get(l.facture_id) || '')) genereeAt.set(l.facture_id, l.created_at)
  }

  // 1. Résolutions automatiques
  const resolusRegen: string[] = [], resolusNeutres: string[] = []
  const restants = (rows || []).filter(r => {
    const statut = (r.facture as any)?.statut ?? r.facture_statut
    const g = r.facture_id ? genereeAt.get(r.facture_id) : undefined
    if (STATUTS_REGENERABLES.includes(statut) && g && g > r.detecte_at) { resolusRegen.push(r.id); return false }
    return true
  })
  const parResa = new Map<string, any[]>()
  for (const r of restants) {
    if (!parResa.has(r.reservation_id)) parResa.set(r.reservation_id, [])
    parResa.get(r.reservation_id)!.push(r)
  }
  const groupes: any[][] = []
  for (const grp of parResa.values()) {
    const first = grp[0], last = grp[grp.length - 1]
    const delta = (last.nouveau_fin_revenue ?? 0) - (first.ancien_fin_revenue ?? 0)
    const neutre = famille(first.ancien_statut) === famille(last.nouveau_statut) && Math.abs(delta) < 100 && !grp.some((r: any) => r.motif)
    if (neutre) resolusNeutres.push(...grp.map((r: any) => r.id))
    else groupes.push(grp)
  }
  if (!dryRun) {
    if (resolusRegen.length) await supabase.from('reservation_changement_post_facture')
      .update({ resolu_at: new Date().toISOString(), resolu_note: 'auto : brouillon régénéré après le changement' }).in('id', resolusRegen)
    if (resolusNeutres.length) await supabase.from('reservation_changement_post_facture')
      .update({ resolu_at: new Date().toISOString(), resolu_note: 'auto : aller-retour sans effet financier (même famille de statut, revenu net inchangé)' }).in('id', resolusNeutres)
  }

  // 2. Publication : une alerte par résa encore impactée + une par ajustement à qualifier
  const items: ItemAlerte[] = groupes.map(grp => {
    const first = grp[0], last = grp[grp.length - 1]
    const statut = (last.facture as any)?.statut ?? last.facture_statut
    const delta = (last.nouveau_fin_revenue ?? 0) - (first.ancien_fin_revenue ?? 0)
    const st = first.ancien_statut !== last.nouveau_statut ? `, ${first.ancien_statut} → ${last.nouveau_statut}` : ''
    const motifs = grp.map((r: any) => r.motif).filter(Boolean)
    return {
      cle: `resa:${last.reservation_id}`,
      libelle: `${last.bien?.hospitable_name || last.bien?.code || '—'} ${last.mois_comptable} — ${last.reservation?.guest_name || last.reservation?.code || '—'} (${last.reservation?.platform || '—'}) modifiée après facture : revenu ${fmtEur(first.ancien_fin_revenue)} → ${fmtEur(last.nouveau_fin_revenue)}${st}${motifs.length ? ` (${motifs.join(' ; ')})` : ''} — facture ${statut}${STATUTS_REGENERABLES.includes(statut) ? ' : régénérer le brouillon' : ' : avoir ou régularisation M+1'}`,
      montant_cts: Math.abs(delta),
      detail: { reservation_id: last.reservation_id, facture_id: last.facture_id, ids: grp.map((r: any) => r.id) },
    }
  })
  const itemsAjust: ItemAlerte[] = (aq || []).map((a: any) => ({
    cle: `ajust:${a.id}`,
    libelle: `Ajustement Hospitable à qualifier — ${a.reservation?.bien?.hospitable_name || a.reservation?.bien?.code || '—'} ${a.reservation?.code || ''} (${a.mois_comptable}) : ${a.label || '—'} ${fmtEur(Math.round((a.montant || 0)))}`,
    montant_cts: Math.abs(Math.round(a.montant || 0)),
    detail: { ajustement_id: a.id },
  }))

  if (!dryRun) {
    const r1 = await signaler(supabase, 'changement_post_facture', AGENCE, items)
    const r2 = await signaler(supabase, 'ajustement_a_qualifier', AGENCE, itemsAjust)
    const nouveaux = groupes.flat().filter((r: any) => !r.alerte_envoyee_at).map((r: any) => r.id)
    if (nouveaux.length) await supabase.from('reservation_changement_post_facture')
      .update({ alerte_envoyee_at: new Date().toISOString() }).in('id', nouveaux)
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_changement_post_facture', source: 'cron', statut: 'ok',
      message: `${items.length} résa(s) modifiée(s) après facturation, ${itemsAjust.length} ajustement(s) à qualifier (agence ${AGENCE}) — ${r1.nouveaux + r2.nouveaux} nouveau(x), ${resolusRegen.length + resolusNeutres.length} clos automatiquement — publié pour le Point du matin`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, resolus_regeneres: resolusRegen.length, resolus_sans_effet: resolusNeutres.length, ouverts: items.length, ajustements: itemsAjust.length, items, items_ajustements: itemsAjust })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
