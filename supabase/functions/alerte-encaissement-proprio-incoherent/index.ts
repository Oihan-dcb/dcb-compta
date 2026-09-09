/**
 * alerte-encaissement-proprio-incoherent — Edge Function Supabase (cron quotidien 8h17 UTC)
 *
 * Failsafe demandé par Oïhan le 09/09/2026, suite à l'incident ITS "Itsasarte" : depuis
 * juillet 2026, l'Airbnb de ce bien envoyait ses paiements sur le compte séquestre DCB
 * (rapprochés avec succès à chaque résa) alors que bien.gestion_loyer=false — le propriétaire
 * était censé encaisser directement. Résultat : _calculerLignes (ventilationCore.js) traite
 * ces résas comme "perçu direct" (horsSequestre=true) et ne calcule JAMAIS de LOY/VIR, alors
 * que DCB détient réellement l'argent. ~11 000€ dus au propriétaire jamais reversés,
 * découverts uniquement parce qu'il a réclamé son loyer.
 *
 * Différence avec alerte-virement-orphelin : celui-là détecte un virement qui n'a PU être
 * rattaché à aucune résa (statut_matching='non_identifie'). Celui-ci détecte l'inverse — le
 * rattachement a RÉUSSI (reservation.rapprochee=true, donc mouvement_bancaire bien identifié
 * et lié), mais le bien est configuré pour ne jamais s'attendre à recevoir cet argent. Les
 * deux sont nécessaires : un virement peut être orphelin (pas de résa) OU rattaché à une résa
 * dont le bien nie recevoir l'argent — deux causes racines différentes, même conséquence.
 *
 * gestion_loyer (pas mode_encaissement) est le vrai déclencheur côté calcul — c'est le champ
 * que ventilationCore.js:horsSequestre lit réellement pour décider si LOY/VIR se calcule.
 *
 * Même architecture que les autres alertes solde/virement : Edge Function partagée DCB/
 * Lauian, cron pg_cron quotidien, mail récap qui s'arrête de lui-même dès que gestion_loyer
 * repasse à true pour le bien concerné (la résa sort alors du périmètre de la requête).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

function htmlRecap(groupes: { bienNom: string; total: string; n: number; lignes: { date: string; guest: string; montant: string }[] }[]) {
  const blocs = groupes.map(g => `
      <tr><td style="padding:20px 24px 6px;font-size:13px;font-weight:bold;color:#2C2416">${g.bienNom} — ${g.n} résa${g.n > 1 ? 's' : ''}, ${g.total} reçus, jamais reversés</td></tr>
      <tr><td style="padding:0 0 10px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr style="background:#FBF5E6"><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Arrivée</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Voyageur</th><th style="padding:8px 14px;font-size:10px;color:#9C8E7D;text-transform:uppercase;text-align:left">Montant reçu</th></tr>
          ${g.lignes.map(l => `
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${l.date}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#2C2416">${l.guest}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #EDE6D8;font-size:13px;color:#CC9933;font-weight:bold">${l.montant}</td>
          </tr>`).join('')}
        </table>
      </td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:40px 20px"><tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:640px;width:100%">
      <tr><td style="background:#C0392B;padding:26px 40px;text-align:center">
        <p style="margin:0;color:#fff;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Destination Côte Basque</p>
        <p style="margin:8px 0 0;color:#fff;font-size:19px;font-weight:bold">🚨 Argent reçu sur un bien "encaissement propriétaire"</p>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">${groupes.length} bien${groupes.length > 1 ? 's' : ''} concerné${groupes.length > 1 ? 's' : ''} — vérifier gestion_loyer</p>
      </td></tr>
      <tr><td style="padding:10px 0 0">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${blocs}
        </table>
      </td></tr>
      <tr><td style="padding:16px 40px;font-size:12px;color:#666;line-height:1.5">
        Ces réservations sont sur un bien marqué gestion_loyer=false ("le propriétaire encaisse
        directement"), mais un virement Airbnb/Booking a bien été rapproché à chacune d'elles —
        l'argent est réellement chez DCB, jamais reversé au propriétaire (horsSequestre=true
        empêche tout calcul de LOY/VIR). Vérifier si le bien a changé de mode d'encaissement
        côté Hospitable/Airbnb sans mise à jour de la fiche bien dans PageBiens.
      </td></tr>
      <tr><td style="background:#f9f6f0;padding:16px 40px;text-align:center;font-size:11px;color:#9C8E7D">
        Généré automatiquement chaque matin tant que le bien reste gestion_loyer=false avec des résas rapprochées.
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

  // Hors champ : résas 2025 (demande Oïhan 09/09/2026, ex. ASKIDA/Aïta — cas isolés anciens,
  // jamais traités, pas de valeur à les resignaler indéfiniment). Ne couvre que l'année en
  // cours et la suite — un futur cas ancien similaire ne polluera pas non plus l'alerte.
  const DATE_MIN = '2026-01-01'

  const { data: resas, error } = await supabase
    .from('reservation')
    .select('id, guest_name, arrival_date, fin_revenue, platform, bien!inner(code, hospitable_name, agence, gestion_loyer)')
    .in('platform', ['airbnb', 'booking'])
    .eq('rapprochee', true)
    .gt('fin_revenue', 0)
    .eq('bien.gestion_loyer', false)
    .eq('bien.agence', AGENCE)
    .gte('arrival_date', DATE_MIN)
    .order('arrival_date')
  if (error) return json({ error: error.message }, 500)

  if (!resas?.length) return json({ ok: true, agence: AGENCE, total: 0 })

  const parBien = new Map<string, { bienNom: string; total: number; lignes: { date: string; guest: string; montant: string }[] }>()
  for (const r of resas) {
    const nom = r.bien?.hospitable_name || r.bien?.code || '—'
    if (!parBien.has(nom)) parBien.set(nom, { bienNom: nom, total: 0, lignes: [] })
    const g = parBien.get(nom)!
    g.total += r.fin_revenue || 0
    g.lignes.push({ date: fmtDate(r.arrival_date), guest: r.guest_name || '—', montant: fmtEur(r.fin_revenue || 0) })
  }
  const groupes = [...parBien.values()].map(g => ({ bienNom: g.bienNom, total: fmtEur(g.total), n: g.lignes.length, lignes: g.lignes }))
  const totalGeneral = [...parBien.values()].reduce((s, g) => s + g.total, 0)

  const to = STAFF_EMAIL[AGENCE] || STAFF_EMAIL.dcb
  if (!dryRun) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: [to],
        subject: `🚨 Argent reçu sur ${groupes.length} bien(s) "encaissement propriétaire" — ${fmtEur(totalGeneral)}`,
        html: htmlRecap(groupes),
      }),
    })
    if (!res.ok) return json({ error: 'erreur_smtp', detail: await res.text() }, 500)
    await supabase.from('journal_ops').insert({
      categorie: 'rapprochement', action: 'alerte_encaissement_proprio_incoherent', source: 'cron', statut: 'ok',
      message: `${resas.length} résa(s) sur ${groupes.length} bien(s) gestion_loyer=false avec virement rapproché (agence ${AGENCE}), ${fmtEur(totalGeneral)}, alerte envoyée à ${to}`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: resas.length, totalMontant: fmtEur(totalGeneral), groupes })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
