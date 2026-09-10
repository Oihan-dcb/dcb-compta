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
      .neq('statut', 'refuse')

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
    .select('id, ventilation_auto_id, bien_id, montant, mois, reservation_id')
    .eq('id', missionId)
    .maybeSingle()

  if (error) return { action: 'error', mission_id: missionId, reason: error.message }
  if (!mission) return { action: 'error', mission_id: missionId, reason: 'Mission introuvable' }

  // Auto-réparation (I-51) : mission pas encore liée mais sa réservation a déjà une ligne AUTO
  // (fenêtre entre la saisie AE et le cron nocturne) → on lie via la RPC puis on recalcule
  // immédiatement, au lieu de skipper et d'attendre la nuit.
  if (!mission.ventilation_auto_id) {
    if (mission.reservation_id) {
      const { data: ligneAuto } = await supabase
        .from('ventilation')
        .select('id')
        .eq('reservation_id', mission.reservation_id)
        .eq('code', 'AUTO')
        .maybeSingle()
      if (ligneAuto?.id) {
        if (!dryRun) {
          await supabase.rpc('lier_ventilation_auto_mission', { p_reservation_id: mission.reservation_id, p_ventilation_id: ligneAuto.id })
        }
        return await traiterVentilAutoId(supabase, ligneAuto.id, dryRun)
      }
    }
    return { action: 'skipped', mission_id: missionId, reason: 'ventilation_auto_id null et aucune ligne AUTO pour la réservation (résa non ventilée ou mission sans résa)' }
  }

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
    .neq('statut', 'refuse')

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

  // ── Garde-fous avant toute écriture (un seul SELECT reservation) ────────────
  const { data: resaInfo, error: rErr } = await supabase
    .from('reservation')
    .select('bien_id, mois_comptable, ventilation_manuelle')
    .eq('id', ventil.reservation_id)
    .maybeSingle()

  // Fail-closed : sans la résa, on ne peut vérifier NI le verrou manuel NI la clôture.
  // Avant ce fix l'erreur était ignorée (`const { data } = ...`) et on écrivait quand même.
  if (rErr) {
    return { action: 'error', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: `Lecture réservation impossible : ${rErr.message}` }
  }
  if (!resaInfo) {
    return { action: 'skipped', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: 'Réservation introuvable — écriture refusée (garde-fous non vérifiables)' }
  }

  // Verrou ajustement manuel (migration 226) : la ventilation de cette résa a été saisie
  // à la main (« ⚖️ Ajuster », ModalResa.jsx:293). AUCUN moteur ne doit la recalculer —
  // ventilation-auto/index.ts:124 et api/ventiler.js:69 le respectent déjà, ce fichier NON.
  // Sans ce garde-fou, la cascade FMEN ci-dessous écrase FMEN.montant_reel, qui PRIME sur
  // montant_ttc dans la facture proprio (facturesEvoliz.js:1276), buildComptaMensuelle.js:196
  // et buildRapportData.js:399 → le montant fixé à la main est remplacé par un dérivé de la
  // provision. Incident 10/09/2026 : TXORIA/HM9BHSSYFR (FMEN manuel 300,00 € → 362,50 €) et
  // OLATUA/HM9NCH8B9T (FMEN manuel 400,00 € → 350,00 €, bien déjà clôturé entre-temps).
  if (resaInfo.ventilation_manuelle === true) {
    return { action: 'skipped', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: 'Ventilation ajustée manuellement (reservation.ventilation_manuelle=true) — recalcul interdit (migration 226)' }
  }

  // Bien clôturé (facture envoyée à Evoliz) : la saisie est FIGÉE — skip propre plutôt
  // qu'une erreur du trigger trg_fige_cloture (migration 227). Les heures saisies après
  // clôture ne modifient plus la facture ; réouvrir la saisie pour les prendre en compte.
  if (!resaInfo.bien_id || !resaInfo.mois_comptable) {
    return { action: 'skipped', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: 'bien_id / mois_comptable absent sur la réservation — clôture non vérifiable, écriture refusée' }
  }
  const { data: cloture, error: cErr } = await supabase
    .from('cloture_bien')
    .select('id')
    .eq('bien_id', resaInfo.bien_id)
    .eq('mois', resaInfo.mois_comptable)
    .eq('active', true)
    .limit(1)
  if (cErr) {
    return { action: 'error', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: `Lecture cloture_bien impossible : ${cErr.message}` }
  }
  if (cloture?.length) {
    return { action: 'skipped', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: 'Bien clôturé (facture envoyée Evoliz) — saisie figée, rouvrir pour appliquer' }
  }

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

    // Mettre à jour FMEN montant_reel si la ligne existe.
    // L'erreur DOIT être remontée : sans ça, un rejet du trigger trg_fige_cloture laissait
    // AUTO.montant_reel écrit et FMEN.montant_reel non écrit, tout en renvoyant
    // action:'updated' + fmen_reel_apres (valeur calculée en mémoire, jamais relue) —
    // incohérence silencieuse entre la réponse de la fonction et l'état réel de la base.
    if (fmenVentil && fmenReelApres !== null) {
      const { error: fErr } = await supabase
        .from('ventilation')
        .update({ montant_reel: Math.max(0, fmenReelApres) })
        .eq('id', fmenVentil.id)
      if (fErr) return { action: 'error', ventilation_auto_id: ventilAutoId, reservation_id: ventil.reservation_id, reason: `AUTO.montant_reel écrit (${totalReel}) mais cascade FMEN REJETÉE : ${fErr.message} — état incohérent, corriger à la main` }
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
