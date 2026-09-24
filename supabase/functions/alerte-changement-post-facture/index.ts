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
 * • dry_run supporté. Seules écritures : alerte_envoyee_at / resolu_at + journal_ops.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const STAFF_EMAIL: Record<string, string> = {
  dcb: 'oihan@destinationcotebasque.com',
  lauian: 'lauracoursan@hotmail.fr',
}
const STATUTS_REGENERABLES = ['brouillon', 'valide']

function fmtEur(cts: number | null | undefined) {
  if (cts == null) return '—'
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}

type Ligne = {
  bien: string; mois: string; resa: string; guest: string; platform: string;
  facture_statut: string; regenerable: boolean;
  ancien_revenu: number | null; nouveau_revenu: number | null;
  ancien_statut: string | null; nouveau_statut: string | null;
  hon_facture: number | null; hon_ventilation: number | null;
  motifs: string[];
}

function htmlRecap(lignes: Ligne[]) {
  const td = 'padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416'
  const sub = 'color:#9C8E7D;font-size:11px'
  const ligne = (l: Ligne) => {
    const delta = (l.nouveau_revenu ?? 0) - (l.ancien_revenu ?? 0)
    const statutChange = l.ancien_statut !== l.nouveau_statut
    return `
    <tr>
      <td style="${td}"><strong>${l.bien}</strong><br><span style="${sub}">${l.mois}</span></td>
      <td style="${td}">${l.resa}<br><span style="${sub}">${l.guest} · ${l.platform}</span></td>
      <td style="${td}">${fmtEur(l.ancien_revenu)} → <strong>${fmtEur(l.nouveau_revenu)}</strong>
        <br><span style="color:${delta < 0 ? '#C0392B' : '#059669'};font-size:11px">${delta >= 0 ? '+' : ''}${fmtEur(delta)}</span>
        ${statutChange ? `<br><span style="${sub}">${l.ancien_statut} → ${l.nouveau_statut}</span>` : ''}
        ${l.motifs.length ? `<br><span style="color:#CC9933;font-size:11px">${l.motifs.join('<br>')}</span>` : ''}</td>
      <td style="${td}">${l.facture_statut}${l.regenerable
        ? `<br><span style="${sub}">HON facture ${fmtEur(l.hon_facture)} / ventilation ${fmtEur(l.hon_ventilation)} HT</span><br><span style="color:#CC9933;font-size:11px;font-weight:bold">→ régénérer le brouillon</span>`
        : `<br><span style="color:#C0392B;font-size:11px;font-weight:bold">→ avoir ou régularisation M+1</span>`}</td>
    </tr>`
  }
  const th = 'padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="760" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:760px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Réservation(s) modifiée(s) après facturation</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${lignes.length} changement${lignes.length > 1 ? 's' : ''} sur des mois déjà facturés</p>
      </td></tr>
      <tr><td style="padding:10px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr style="background:#FBF5E6"><th style="${th}">Bien / mois</th><th style="${th}">Réservation</th><th style="${th}">Revenu</th><th style="${th}">Facture</th></tr>
          ${lignes.map(ligne).join('')}
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px;font-size:12px;color:#666;line-height:1.5">
        Le revenu ou le statut de ces réservations a changé côté Hospitable (annulation, résolution Airbnb,
        modification) alors que la facture honoraires du mois était déjà générée. La facture ne se met
        <strong>jamais</strong> à jour toute seule.<br>
        • <strong>Brouillon / validée</strong> : régénérer le brouillon du mois depuis Facturation (l'alerte se clôt d'elle-même).<br>
        • <strong>Envoyée Evoliz / payée</strong> : la ventilation est verrouillée, l'écart n'apparaît nulle part ailleurs —
        faire un avoir ou une régularisation sur le mois suivant, puis poser <code>resolu_at</code> dans
        <code>reservation_changement_post_facture</code>.
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement — chaque changement n'est signalé qu'une fois.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

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
  if (!rows?.length) return json({ ok: true, agence: AGENCE, ouverts: 0 })

  // Lignes de facture (date de (re)génération + HON facturé)
  const factureIds = [...new Set(rows.map(r => r.facture_id).filter(Boolean))] as string[]
  const lignesFacture = new Map<string, { generee_at: string; hon: number }>()
  if (factureIds.length) {
    const { data: lf } = await supabase.from('facture_evoliz_ligne')
      .select('facture_id, code, montant_ht, created_at').in('facture_id', factureIds)
    for (const l of lf || []) {
      const cur = lignesFacture.get(l.facture_id) || { generee_at: '', hon: 0 }
      if (l.created_at > cur.generee_at) cur.generee_at = l.created_at
      if (l.code === 'HON') cur.hon += l.montant_ht || 0
      lignesFacture.set(l.facture_id, cur)
    }
  }

  // 1. Résolution automatique des brouillons régénérés après le changement
  const resolus: string[] = []
  const ouverts = rows.filter(r => {
    const statut = (r.facture as any)?.statut ?? r.facture_statut
    const lf = r.facture_id ? lignesFacture.get(r.facture_id) : undefined
    if (STATUTS_REGENERABLES.includes(statut) && lf && lf.generee_at > r.detecte_at) {
      resolus.push(r.id)
      return false
    }
    return true
  })
  if (resolus.length && !dryRun) {
    await supabase.from('reservation_changement_post_facture')
      .update({ resolu_at: new Date().toISOString(), resolu_note: 'auto : brouillon régénéré après le changement' })
      .in('id', resolus)
  }

  // 2. Nouveaux changements à signaler — regroupés par résa (1er ancien → dernier nouveau)
  const nouveaux = ouverts.filter(r => !r.alerte_envoyee_at)
  if (!nouveaux.length) return json({ ok: true, agence: AGENCE, resolus_auto: resolus.length, ouverts: ouverts.length, nouveaux: 0 })

  // HON actuel en ventilation (propriétaire × mois) pour les factures régénérables
  const honVentil = new Map<string, number>()
  const couples = [...new Set(nouveaux.map(r => `${r.proprietaire_id}|${r.mois_comptable}`))]
  for (const c of couples) {
    const [pid, mois] = c.split('|')
    const { data: v } = await supabase.from('ventilation')
      .select('montant_ht').eq('proprietaire_id', pid).eq('mois_comptable', mois).eq('code', 'HON')
    honVentil.set(c, (v || []).reduce((s, x) => s + (x.montant_ht || 0), 0))
  }

  const parResa = new Map<string, any[]>()
  for (const r of nouveaux) {
    if (!parResa.has(r.reservation_id)) parResa.set(r.reservation_id, [])
    parResa.get(r.reservation_id)!.push(r)
  }
  const lignes: Ligne[] = [...parResa.values()].map(grp => {
    const first = grp[0], last = grp[grp.length - 1]
    const statut = (last.facture as any)?.statut ?? last.facture_statut
    const regenerable = STATUTS_REGENERABLES.includes(statut)
    return {
      bien: last.bien?.hospitable_name || last.bien?.code || '—',
      mois: last.mois_comptable,
      resa: last.reservation?.code || last.reservation_id,
      guest: last.reservation?.guest_name || '—',
      platform: last.reservation?.platform || '—',
      facture_statut: statut,
      regenerable,
      ancien_revenu: first.ancien_fin_revenue, nouveau_revenu: last.nouveau_fin_revenue,
      ancien_statut: first.ancien_statut, nouveau_statut: last.nouveau_statut,
      hon_facture: regenerable && last.facture_id ? (lignesFacture.get(last.facture_id)?.hon ?? null) : null,
      hon_ventilation: regenerable ? (honVentil.get(`${last.proprietaire_id}|${last.mois_comptable}`) ?? null) : null,
      motifs: grp.map((r: any) => r.motif).filter(Boolean),
    }
  })

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `⚠ ${lignes.length} réservation${lignes.length > 1 ? 's' : ''} modifiée${lignes.length > 1 ? 's' : ''} après facturation`,
        html: htmlRecap(lignes),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('reservation_changement_post_facture')
      .update({ alerte_envoyee_at: new Date().toISOString() })
      .in('id', nouveaux.map(r => r.id))
    await supabase.from('journal_ops').insert({
      categorie: 'facturation', action: 'alerte_changement_post_facture', source: 'cron', statut: 'ok',
      message: `${lignes.length} résa(s) modifiée(s) après facturation (agence ${AGENCE}), alerte envoyée à ${to}`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, resolus_auto: resolus.length, ouverts: ouverts.length, nouveaux: lignes.length, lignes })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
