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
import { signaler, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const SOURCE = 'encaissement_proprio_incoherent'

function fmtEur(cts: number) {
  return (cts / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €'
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
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

  if (!resas?.length) {
    if (!dryRun) await signaler(supabase, SOURCE, AGENCE, [])
    return json({ ok: true, agence: AGENCE, total: 0 })
  }

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

  // Une alerte par résa (clé stable) : une nouvelle résa sur le même bien = une nouveauté
  const items: ItemAlerte[] = resas.map(r => ({
    cle: `resa:${r.id}`,
    libelle: `${r.bien?.hospitable_name || r.bien?.code || '—'} (bien « encaissement propriétaire ») — ${r.platform} ${r.guest_name || '—'} arrivé le ${r.arrival_date.split('-').reverse().join('/')} : virement reçu sur le séquestre, aucun reversement calculé`,
    montant_cts: r.fin_revenue || 0,
    detail: { reservation_id: r.id },
  }))
  if (!dryRun) {
    const res = await signaler(supabase, SOURCE, AGENCE, items)
    await supabase.from('journal_ops').insert({
      categorie: 'rapprochement', action: 'alerte_encaissement_proprio_incoherent', source: 'cron', statut: 'ok',
      message: `${resas.length} résa(s) sur ${groupes.length} bien(s) gestion_loyer=false avec virement rapproché (agence ${AGENCE}), ${fmtEur(totalGeneral)} — ${res.nouveaux} nouvelle(s), publiée(s) pour le Point du matin`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: resas.length, totalMontant: fmtEur(totalGeneral), groupes })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
