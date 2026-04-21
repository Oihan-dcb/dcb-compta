import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * update-ventilation-auto
 *
 * Met à jour ventilation.montant_reel (code='AUTO') avec le total réel des missions AE.
 *
 * Modes :
 *   { mission_id }        → recalcule le ventilation_auto_id lié à cette mission
 *   { mois: 'YYYY-MM' }  → batch : recalcule toutes les lignes AUTO du mois
 *   + dry_run: true       → simule sans écrire (pour test)
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  let body: { mission_id?: string; mois?: string; dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* GET sans body accepté */ }

  const dryRun = body.dry_run === true

  // ── Mode 1 : mission_id unique ─────────────────────────────────────────────
  if (body.mission_id) {
    const result = await traiterMission(supabase, body.mission_id, dryRun)
    return json({ dry_run: dryRun, ...result })
  }

  // ── Mode 2 : batch mois ────────────────────────────────────────────────────
  if (body.mois) {
    const { data: missions, error } = await supabase
      .from('mission_menage')
      .select('id, ventilation_auto_id')
      .eq('mois', body.mois)
      .not('ventilation_auto_id', 'is', null)
      .not('montant', 'is', null)
      .neq('statut', 'cancelled')

    if (error) return json({ error: error.message }, 500)

    // Dédupliquer par ventilation_auto_id — on traite chaque ligne AUTO une seule fois
    const ventilIds = [...new Set((missions || []).map(m => m.ventilation_auto_id))]
    const results = []

    for (const ventilId of ventilIds) {
      const r = await traiterVentilAutoId(supabase, ventilId, dryRun)
      results.push(r)
    }

    const updated  = results.filter(r => r.action === 'updated').length
    const skipped  = results.filter(r => r.action === 'skipped').length
    const unchanged = results.filter(r => r.action === 'unchanged').length
    const errors   = results.filter(r => r.action === 'error').length

    return json({ dry_run: dryRun, mois: body.mois, total: results.length, updated, skipped, unchanged, errors, details: results })
  }

  return json({ error: 'Paramètre requis : mission_id ou mois' }, 400)
})

// ─── Traitement d'une mission ──────────────────────────────────────────────

async function traiterMission(supabase: ReturnType<typeof createClient>, missionId: string, dryRun: boolean) {
  const { data: mission, error } = await supabase
    .from('mission_menage')
    .select('id, ventilation_auto_id, bien_id, montant, mois')
    .eq('id', missionId)
    .maybeSingle()

  if (error) return { action: 'error', mission_id: missionId, reason: error.message }
  if (!mission) return { action: 'error', mission_id: missionId, reason: 'Mission introuvable' }
  if (!mission.ventilation_auto_id) return { action: 'skipped', mission_id: missionId, reason: 'ventilation_auto_id null — mission non liée' }

  return await traiterVentilAutoId(supabase, mission.ventilation_auto_id, dryRun)
}

// ─── Traitement d'une ligne ventilation AUTO ───────────────────────────────

async function traiterVentilAutoId(supabase: ReturnType<typeof createClient>, ventilAutoId: string, dryRun: boolean) {
  // Somme toutes les missions liées à cette ligne ventilation AUTO
  const { data: missions, error: mErr } = await supabase
    .from('mission_menage')
    .select('id, montant, ae_id, bien_id, reservation_id')
    .eq('ventilation_auto_id', ventilAutoId)
    .not('montant', 'is', null)
    .neq('statut', 'cancelled')

  if (mErr) return { action: 'error', ventilation_auto_id: ventilAutoId, reason: mErr.message }
  if (!missions?.length) return { action: 'skipped', ventilation_auto_id: ventilAutoId, reason: 'Aucune mission avec montant' }

  const totalReel = missions.reduce((s, m) => s + (m.montant || 0), 0)

  // Récupère la ligne ventilation actuelle
  const { data: ventil, error: vErr } = await supabase
    .from('ventilation')
    .select('id, montant_ht, montant_reel, reservation_id, code')
    .eq('id', ventilAutoId)
    .eq('code', 'AUTO')
    .maybeSingle()

  if (vErr) return { action: 'error', ventilation_auto_id: ventilAutoId, reason: vErr.message }
  if (!ventil) return { action: 'skipped', ventilation_auto_id: ventilAutoId, reason: 'Ligne ventilation AUTO introuvable' }

  const provision = ventil.montant_ht || 0
  const reelActuel = ventil.montant_reel

  if (reelActuel === totalReel) {
    return { action: 'unchanged', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, provision, reel_actuel: reelActuel, total_missions: totalReel }
  }

  // Calculer FMEN réel : FMEN_provision + AUTO_provision - AUTO_réel
  // AUTO est déduit du MEN pour donner FMEN — quand le réel change, FMEN s'adapte
  const { data: fmenVentil } = await supabase
    .from('ventilation')
    .select('id, montant_ttc, montant_reel')
    .eq('reservation_id', ventil.reservation_id)
    .eq('code', 'FMEN')
    .maybeSingle()

  const fmenReelApres = fmenVentil
    ? (fmenVentil.montant_ttc || 0) + provision - totalReel
    : null

  if (!dryRun) {
    const { error: uErr } = await supabase
      .from('ventilation')
      .update({ montant_reel: totalReel })
      .eq('id', ventilAutoId)

    if (uErr) return { action: 'error', ventilation_auto_id: ventilAutoId, reason: uErr.message }

    // Mettre à jour FMEN montant_reel si la ligne existe
    if (fmenVentil && fmenReelApres !== null) {
      await supabase
        .from('ventilation')
        .update({ montant_reel: Math.max(0, fmenReelApres) })
        .eq('id', fmenVentil.id)
    }
  }

  return {
    action: 'updated',
    ventilation_auto_id: ventilAutoId,
    reservation_id: ventil.reservation_id,
    provision,
    reel_avant: reelActuel,
    reel_apres: totalReel,
    ecart: totalReel - provision,
    fmen_provision: fmenVentil?.montant_ttc ?? null,
    fmen_reel_apres: fmenReelApres !== null ? Math.max(0, fmenReelApres) : null,
    missions: missions.map(m => ({ id: m.id, montant: m.montant })),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  }
}
