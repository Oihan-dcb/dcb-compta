/**
 * alerte-virement-orphelin — Edge Function Supabase (cron quotidien 8h13 UTC via pg_cron)
 *
 * Failsafe demandé par Oïhan le 09/09/2026 : alerte quand un virement entrant OTA (Airbnb/
 * Booking) sur le compte séquestre n'a pu être rattaché à aucune réservation
 * (mouvement_bancaire.statut_matching='non_identifie' — le moteur de rapprochement
 * (src/services/rapprochement.js) a explicitement tenté et abandonné, ce n'est pas un simple
 * retard de traitement). Cas type visé : un propriétaire passe de gestion_loyer=false à true
 * — les réservations déjà synchronisées avant le changement n'ont jamais généré de ligne
 * ventilation VIR (horsSequestre était vrai au moment du calcul), donc le vrai virement
 * Airbnb qui arrive ensuite ne trouve rien à quoi se rattacher.
 *
 * 'non_identifie' est un statut TERMINAL (posé après échec du matching), à ne pas confondre
 * avec 'en_attente' qui couvre aussi un énorme historique jamais repassé au crible (des
 * centaines de mouvements 2025 jamais traités) — masse non actionnable au quotidien, donc
 * volontairement ignorée ici.
 *
 * Filtré sur canal IN ('airbnb','booking') — les circuits OTA concernés par le scénario
 * décrit — et credit > 100 (1€) pour exclure les virements-test Airbnb à 0,01€ (vérification
 * de RIB, aucune valeur informative).
 *
 * Même architecture que alerte-solde-manuel/alerte-solde-booking-platform : un seul Edge
 * Function partagé DCB/Lauian, agence passée dans le body du cron, mail récap quotidien qui
 * s'arrête de lui-même dès que le mouvement est rapproché (ou requalifié 'non_gere').
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signaler, type ItemAlerte } from '../_shared/alertes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CANAUX_OTA = ['airbnb', 'booking']
const SEUIL_CTS = 100 // 1€ — exclut les virements-test Airbnb à 0,01€

const SOURCE = 'virement_orphelin'

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

  const { data: mouvements, error } = await supabase
    .from('mouvement_bancaire')
    .select('id, date_operation, libelle, detail, credit, canal, source')
    .eq('agence', AGENCE)
    .eq('statut_matching', 'non_identifie')
    .in('canal', CANAUX_OTA)
    .gt('credit', SEUIL_CTS)
    .order('date_operation')
  if (error) return json({ error: error.message }, 500)

  if (!mouvements?.length) {
    if (!dryRun) await signaler(supabase, SOURCE, AGENCE, [])
    return json({ ok: true, agence: AGENCE, total: 0 })
  }

  const rows = mouvements.map(m => ({
    date: fmtDate(m.date_operation),
    libelle: m.libelle || m.detail || '—',
    canal: m.canal,
    montant: fmtEur(m.credit),
  }))

  const items: ItemAlerte[] = mouvements.map(m => ({
    cle: `mvt:${m.id}`,
    libelle: `Virement ${m.canal} du ${m.date_operation.split('-').reverse().join('/')} (${(m.libelle || m.detail || '—').slice(0, 60)}) sans réservation associée`,
    montant_cts: m.credit,
    detail: { mouvement_id: m.id },
  }))
  if (!dryRun) {
    const res = await signaler(supabase, SOURCE, AGENCE, items)
    await supabase.from('journal_ops').insert({
      categorie: 'rapprochement', action: 'alerte_virement_orphelin', source: 'cron', statut: 'ok',
      message: `${mouvements.length} virement(s) OTA non identifié(s) (agence ${AGENCE}) — ${res.nouveaux} nouveau(x), publié(s) pour le Point du matin`,
    })
  }

  return json({ dry_run: dryRun, agence: AGENCE, total: mouvements.length, rows })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } })
}
