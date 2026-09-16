/**
 * alerte-prestation-doublon — Edge Function Supabase (cron quotidien 8h25 UTC via pg_cron)
 *
 * Garde-fou demandé par Oïhan le 16/09/2026, suite à l'incident ONGI : Laura a saisi deux fois
 * la même prestation `dcb_direct` (12,50 €, bien ONGI, 23/08/2026) à 62 secondes d'écart —
 * double-clic / double-soumission du formulaire. Elle a cru avoir supprimé le doublon APRÈS la
 * clôture du bien/mois, alors qu'aucun DELETE réel n'existe côté UI pour `prestation_hors_forfait`
 * (PagePrestationsAE.jsx n'expose que `annuler()`, un UPDATE de statut) — et que même un vrai
 * DELETE aurait été bloqué sans exception par `check_cloture_bien_fige` (aucune dérogation DELETE
 * n'existe sur cette table, contrairement aux transitions de statut en UPDATE). Le doublon est
 * resté `statut='valide'` pendant des semaines, sans que personne ne s'en aperçoive avant un
 * signalement manuel.
 *
 * Ce garde-fou ne corrige pas la cause du double-clic (aucune protection anti-doublon au submit
 * n'existe dans PagePrestationsAE.jsx) — il rend le doublon VISIBLE dès le lendemain de sa
 * création, avant que le mois ne soit clôturé et que la correction devienne une opération à
 * risque (réouverture de clôture, suppression manuelle en base). Même architecture que les
 * alertes existantes (alerte-mission-menage-orpheline, alerte-solde-manuel, …) : une seule Edge
 * Function DCB/Lauian, agence passée dans le body, mail récap, `dry_run` supporté, LECTURE SEULE
 * sur les données métier (seule écriture : la ligne d'audit `journal_ops`).
 *
 * ── Périmètre ──────────────────────────────────────────────────────────────────────────────
 * • statut = 'valide' uniquement : un doublon déjà `annule` par le staff est déjà réglé,
 *   pas la peine de le signaler.
 * • Regroupement par (bien_id, date_prestation, montant, type_imputation, description, ae_id) :
 *   deux lignes ne sont des "doublons" que si TOUT est identique, y compris la description et
 *   l'AE — ce qui exclut les faux positifs légitimes (ex: deux AE différents, même bien, même
 *   montant, même jour, description différente — cas réel trouvé en base, mois 2026-05).
 * • date_prestation IS NOT NULL : les lignes historiques sans date (imports groupés) ne sont
 *   pas comparables entre elles de façon fiable.
 * • DATE_MIN = '2026-01-01' et JOURS_DELAI = 1 : un doublon n'est signalé qu'à partir du
 *   lendemain de sa création — laisse le temps à une correction immédiate en session (l'AE ou
 *   le staff qui voit son double-clic tout de suite) sans bruit inutile.
 * • Échappatoire : `#dedup-ok` dans la description d'UNE des lignes du groupe neutralise
 *   l'alerte pour tout le groupe (cas légitime où deux prestations identiques coexistent).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const DATE_MIN        = '2026-01-01'
const JOURS_DELAI      = 1
const MARQUEUR_IGNORE  = '#dedup-ok'

const STAFF_EMAIL: Record<string, string> = {
  dcb: 'oihan@destinationcotebasque.com',
  lauian: 'lauracoursan@hotmail.fr',
}

function fmtEur(cts: number) {
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type Groupe = {
  bien: string; date: string; montant: string; type_imputation: string; description: string;
  ae: string; mois: string; clos: boolean; ids: string[]; n: number;
}

function htmlRecap(groupes: Groupe[], total: string) {
  const ligne = (g: Groupe) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${g.date}<br><span style="color:#9C8E7D;font-size:11px">${g.mois}${g.clos ? ' <span style="color:#C0392B;font-weight:bold">CLÔTURÉ</span>' : ''}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416"><strong>${g.bien}</strong><br><span style="color:#9C8E7D;font-size:11px">${g.description}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:12px;color:#2C2416">${g.ae}<br><span style="color:#9C8E7D;font-size:11px;text-transform:uppercase">${g.type_imputation}</span></td>
      <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${g.montant} <span style="color:#9C8E7D;font-weight:normal">× ${g.n}</span></td>
    </tr>`
  const entete = `
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Date</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Bien / description</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">AE / imputation</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;letter-spacing:.5px;text-align:left">Montant (× occurrences)</th></tr>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="700" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:700px;width:100%">
      <tr><td style="background:#CC9933;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">⚠ Prestation(s) hors forfait en double</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${groupes.length} doublon${groupes.length > 1 ? 's' : ''} détecté${groupes.length > 1 ? 's' : ''} · ${total} en trop si non corrigé</p>
      </td></tr>
      <tr><td style="padding:10px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0">${entete}${groupes.map(ligne).join('')}
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px;font-size:12px;color:#666;line-height:1.5">
        Même bien, même date, même montant, même type d'imputation, même description, même AE :
        très probablement une double saisie (double-clic). Vérifier dans Auto-entrepreneurs / Prestations,
        puis annuler la ligne en trop. Si le mois est <strong>CLÔTURÉ</strong>, rouvrir la saisie depuis
        Facturation avant toute correction, puis reclôturer. Si les deux lignes sont légitimement
        identiques, ajouter <code>${MARQUEUR_IGNORE}</code> dans la description pour ne plus être alerté.
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement chaque matin tant que le doublon persiste — s'arrête dès qu'une des lignes est annulée.
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

  const today   = new Date().toISOString().slice(0, 10)
  const dateMax = addDays(today, -JOURS_DELAI)

  const { data: prestations, error } = await supabase
    .from('prestation_hors_forfait')
    .select('id, bien_id, date_prestation, montant, type_imputation, description, ae_id, mois, created_at, bien:bien_id!inner(code, hospitable_name, agence), ae:ae_id(prenom, nom)')
    .eq('statut', 'valide')
    .not('date_prestation', 'is', null)
    .gte('date_prestation', DATE_MIN)
    .lte('date_prestation', dateMax)
    .eq('bien.agence', AGENCE)
    .order('date_prestation')
  if (error) return json({ error: error.message }, 500)

  const clef = (p: any) => `${p.bien_id}|${p.date_prestation}|${p.montant}|${p.type_imputation}|${p.description || ''}|${p.ae_id || ''}`
  const groupesMap = new Map<string, any[]>()
  for (const p of prestations || []) {
    if ((p.description || '').toLowerCase().includes(MARQUEUR_IGNORE)) continue
    const k = clef(p)
    if (!groupesMap.has(k)) groupesMap.set(k, [])
    groupesMap.get(k)!.push(p)
  }

  const bienIds = [...new Set(prestations?.map(p => p.bien_id) || [])]
  const mois = [...new Set(prestations?.map(p => p.mois).filter(Boolean) || [])]
  const closSet = new Set<string>()
  if (bienIds.length && mois.length) {
    const { data: clot } = await supabase
      .from('cloture_bien')
      .select('bien_id, mois')
      .eq('active', true)
      .in('bien_id', bienIds)
      .in('mois', mois)
    for (const c of clot || []) closSet.add(`${c.bien_id}|${c.mois}`)
  }

  const groupes: Groupe[] = []
  let totalCts = 0
  for (const rows of groupesMap.values()) {
    if (rows.length < 2) continue
    const p = rows[0]
    totalCts += (p.montant || 0) * (rows.length - 1)
    groupes.push({
      bien: p.bien?.hospitable_name || p.bien?.code || '— bien inconnu —',
      date: fmtDate(p.date_prestation),
      montant: fmtEur(p.montant || 0),
      type_imputation: p.type_imputation || '—',
      description: p.description || '—',
      ae: [p.ae?.prenom, p.ae?.nom].filter(Boolean).join(' ') || '—',
      mois: p.mois || '—',
      clos: closSet.has(`${p.bien_id}|${p.mois}`),
      ids: rows.map(r => r.id),
      n: rows.length,
    })
  }

  if (!groupes.length) return json({ ok: true, agence: AGENCE, total: 0 })

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `⚠ ${groupes.length} prestation${groupes.length > 1 ? 's' : ''} en double détectée${groupes.length > 1 ? 's' : ''}`,
        html: htmlRecap(groupes, fmtEur(totalCts)),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'prestation_hors_forfait', action: 'alerte_prestation_doublon', source: 'cron', statut: 'ok',
      message: `${groupes.length} doublon(s) de prestation détecté(s) (agence ${AGENCE}), ${fmtEur(totalCts)} en trop si non corrigé, alerte envoyée à ${to}`,
    })
  }

  return json({
    dry_run: dryRun, agence: AGENCE,
    seuil_jours: JOURS_DELAI, date_max: dateMax,
    total: groupes.length, montant_trop_percu: fmtEur(totalCts),
    groupes,
  })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
