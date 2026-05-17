/**
 * Edge Function — allocate-encaissements (v2)
 *
 * Source de vérité unique : mouvement_bancaire.credit (valeur CSV réelle importée)
 *
 * Chemins autorisés pour prouver un encaissement (dans cet ordre) :
 *   1. ventilation.mouvement_id → mouvement_bancaire.credit
 *   2. reservation_paiement.mouvement_id → mouvement_bancaire.credit
 *   3. payout_reservation → payout_hospitable.mouvement_id → mouvement_bancaire.credit
 *
 * Règles absolues :
 *   - Déduplication par mouvement_bancaire.id (un mb ne compte qu'une fois par résa)
 *   - Crédits entrants uniquement (credit > 0)
 *   - Si au moins un lien → PROUVEE (preuve_niveau='prouve')
 *   - Si aucun lien → NON_PROUVEE → anomalie MOUVEMENT_BANCAIRE_MISSING
 *   - Aucun fallback sur payout_hospitable.amount
 *   - Aucune catégorie APPROXIMEE
 *
 * Body attendu : { mois: "YYYY-MM" }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logError } from '../_shared/logError.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
    status,
  })
}

interface MbLink {
  mb_id: string
  credit: number
  source: 'ventilation' | 'reservation_paiement' | 'payout_hospitable' | 'booking_payout_line' | 'stripe_payout_line'
  source_ref: string   // mouvement_id (ventilation), rp.id, ph.id, bpl.mouvement_id, spl.mouvement_id
  libelle?: string
  date_operation?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { mois, agence = 'dcb' } = await req.json()
    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
      throw new Error('mois invalide — format YYYY-MM attendu')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )

    // ── 1. Réservations du mois (agence uniquement) ───────────────────────────
    const { data: biensAgence, error: biensErr } = await supabase
      .from('bien')
      .select('id, mode_encaissement')
      .eq('agence', agence)
    if (biensErr) throw biensErr
    const biensDcbIds = (biensAgence || []).map(b => b.id)
    // Biens où la plateforme encaisse directement pour le proprio (Airbnb/Booking → proprio)
    // DCB ne reçoit jamais ces virements → exclure des anomalies (miroir de PageFactures PLATFORMS_DCB_CTRL)
    const PLATFORMS_DCB_CTRL = new Set(['direct', 'manual'])
    const biensProprio = new Set(
      (biensAgence || []).filter(b => b.mode_encaissement === 'proprio').map(b => b.id)
    )
    if (!biensDcbIds.length) {
      return jsonResp({
        reservations_total: 0, prouvees: 0, non_prouvees: 0, anomalies: 0,
        message: `Aucun bien trouvé pour agence=${agence}`,
      })
    }

    const { data: resas, error: resasErr } = await supabase
      .from('reservation')
      .select('id, bien_id, fin_revenue, platform, mois_comptable, platform_id, code, final_status, owner_stay')
      .eq('mois_comptable', mois)
      .eq('owner_stay', false)
      .gt('fin_revenue', 0)
      .in('bien_id', biensDcbIds)

    if (resasErr) throw resasErr

    // Exclure les resas proprio_encaissé : biens mode_encaissement='proprio' sur plateforme non-DCB
    // (Airbnb/Booking vire directement au proprio — DCB ne reçoit jamais ces montants)
    const resasFiltered = (resas || []).filter(r =>
      !biensProprio.has(r.bien_id) || PLATFORMS_DCB_CTRL.has(r.platform)
    )

    if (!resasFiltered.length) {
      return jsonResp({
        reservations_total: 0, prouvees: 0, non_prouvees: 0, anomalies: 0,
        message: 'Aucune réservation pour ce mois',
      })
    }

    const resaIds = resasFiltered.map(r => r.id)
    const resaById: Record<string, typeof resasFiltered[0]> = {}
    // Maps inverses pour chemins 4 et 5
    const resaIdByPlatformId: Record<string, string> = {}  // booking_ref → reservation_id
    const resaIdByCode: Record<string, string> = {}        // reservation.code → reservation_id
    for (const r of resasFiltered) {
      resaById[r.id] = r
      if (r.platform === 'booking' && r.platform_id) resaIdByPlatformId[r.platform_id] = r.id
      if (r.code) resaIdByCode[r.code] = r.id
    }
    const bookingPlatformIds = Object.keys(resaIdByPlatformId)
    const allResaCodes = Object.keys(resaIdByCode)

    // ── 2. Récupérer tous les liens bancaires en parallèle ────────────────────

    // Resas annulées avec frais : on vérifie si un reservation_paiement existe (mouvement_id ou non)
    // Si oui → déjà comptabilisé, pas d'anomalie à générer
    const cancelledResaIds = resasFiltered
      .filter(r => r.final_status === 'cancelled')
      .map(r => r.id)

    const [ventilationRes, rpRes, payoutRes, bookingPayoutRes, stripePayoutRes, cancelledRpRes] = await Promise.all([

      // Chemin 1 : ventilation.mouvement_id (legacy + reversements manuels)
      supabase
        .from('ventilation')
        .select('reservation_id, mouvement_id, mouvement_bancaire(id, credit, libelle, date_operation)')
        .in('reservation_id', resaIds)
        .not('mouvement_id', 'is', null),

      // Chemin 2 : reservation_paiement.mouvement_id (SEPA manuel, Stripe, Booking via _lierViaPayout)
      supabase
        .from('reservation_paiement')
        .select('id, reservation_id, mouvement_id, mouvement_bancaire(id, credit, libelle, date_operation)')
        .in('reservation_id', resaIds)
        .not('mouvement_id', 'is', null),

      // Chemin 3 : payout_hospitable via payout_reservation (Airbnb, Booking)
      supabase
        .from('payout_reservation')
        .select('reservation_id, payout_hospitable!inner(id, mouvement_id, mouvement_bancaire(id, credit, libelle, date_operation))')
        .in('reservation_id', resaIds),

      // Chemin 4 : booking_payout_line — utilise amount_cents (part de cette résa dans le virement groupé)
      bookingPlatformIds.length > 0
        ? supabase
            .from('booking_payout_line')
            .select('mouvement_id, booking_ref, amount_cents, mouvement_bancaire(id, credit, libelle, date_operation)')
            .in('booking_ref', bookingPlatformIds)
            .not('mouvement_id', 'is', null)
        : Promise.resolve({ data: [] as any[], error: null }),

      // Chemin 5 : stripe_payout_line — utilise montant_net (part de cette résa dans le virement groupé Stripe)
      allResaCodes.length > 0
        ? supabase
            .from('stripe_payout_line')
            .select('mouvement_id, reservation_code, montant_net, mouvement_bancaire(id, credit, libelle, date_operation)')
            .in('reservation_code', allResaCodes)
            .not('mouvement_id', 'is', null)
        : Promise.resolve({ data: [] as any[], error: null }),

      // Chemin 6 : reservation_paiement pour annulées (sans filtre mouvement_id)
      // Permet de détecter les annulations avec frais déjà comptabilisées même sans rapprochement bancaire
      cancelledResaIds.length > 0
        ? supabase
            .from('reservation_paiement')
            .select('reservation_id')
            .in('reservation_id', cancelledResaIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ])

    if (ventilationRes.error) throw new Error(`Erreur ventilation: ${ventilationRes.error.message}`)
    if (rpRes.error) throw new Error(`Erreur reservation_paiement: ${rpRes.error.message}`)
    if (payoutRes.error) throw new Error(`Erreur payout_reservation: ${payoutRes.error.message}`)
    if (bookingPayoutRes.error) throw new Error(`Erreur booking_payout_line: ${bookingPayoutRes.error.message}`)
    if (stripePayoutRes.error) throw new Error(`Erreur stripe_payout_line: ${stripePayoutRes.error.message}`)
    if (cancelledRpRes.error) throw new Error(`Erreur cancelled_reservation_paiement: ${cancelledRpRes.error.message}`)

    // Set des resas annulées qui ont au moins un reservation_paiement → pas d'anomalie
    const cancelledWithPayment = new Set(
      (cancelledRpRes.data || []).map((r: any) => r.reservation_id)
    )

    // ── 3. Construire la map : reservation_id → liens dédupliqués par mb_id ──
    // Ordre de priorité : ventilation > reservation_paiement > payout_hospitable
    // Si le même mb_id arrive par deux chemins, on garde la source la plus haute

    const linksByResa = new Map<string, Map<string, MbLink>>()

    function ensureResa(resaId: string): Map<string, MbLink> {
      if (!linksByResa.has(resaId)) linksByResa.set(resaId, new Map())
      return linksByResa.get(resaId)!
    }

    // Chemin 1 : ventilation
    for (const v of (ventilationRes.data || [])) {
      const mb = v.mouvement_bancaire as any
      if (!mb?.id || !(mb.credit > 0)) continue
      const map = ensureResa(v.reservation_id)
      if (!map.has(mb.id)) {
        map.set(mb.id, {
          mb_id: mb.id,
          credit: mb.credit,
          source: 'ventilation',
          source_ref: v.mouvement_id,
          libelle: mb.libelle,
          date_operation: mb.date_operation,
        })
      }
    }

    // Chemin 2 : reservation_paiement
    // Utilise min(fin_revenue, mb.credit) :
    //   - Si mb.credit > fin_revenue (payout partagé entre plusieurs resas) → fin_revenue évite le double-comptage
    //   - Si mb.credit < fin_revenue (paiement partiel) → mb.credit = montant réellement reçu
    for (const rp of (rpRes.data || [])) {
      const mb = rp.mouvement_bancaire as any
      if (!mb?.id || !(mb.credit > 0)) continue
      const map = ensureResa(rp.reservation_id)
      if (!map.has(mb.id)) {
        const resaFin = resaById[rp.reservation_id]?.fin_revenue
        const credit = resaFin != null ? Math.min(resaFin, mb.credit) : mb.credit
        map.set(mb.id, {
          mb_id: mb.id,
          credit,
          source: 'reservation_paiement',
          source_ref: rp.id,
          libelle: mb.libelle,
          date_operation: mb.date_operation,
        })
      }
    }

    // Chemin 3 : payout_hospitable
    for (const pr of (payoutRes.data || [])) {
      const ph = pr.payout_hospitable as any
      if (!ph?.mouvement_id) continue
      const mb = ph.mouvement_bancaire as any
      if (!mb?.id || !(mb.credit > 0)) continue
      const map = ensureResa(pr.reservation_id)
      if (!map.has(mb.id)) {
        map.set(mb.id, {
          mb_id: mb.id,
          credit: mb.credit,
          source: 'payout_hospitable',
          source_ref: ph.id,
          libelle: mb.libelle,
          date_operation: mb.date_operation,
        })
      }
    }

    // Chemin 4 : booking_payout_line
    // Utilise amount_cents (montant par résa dans le virement groupé), pas mb.credit (total virement)
    for (const bpl of (bookingPayoutRes.data || [])) {
      const mb = bpl.mouvement_bancaire as any
      if (!mb?.id) continue
      const resaId = resaIdByPlatformId[bpl.booking_ref]
      if (!resaId) continue
      // amount_cents = part de cette résa dans le virement Booking (valeur CSV attribuable)
      const credit = bpl.amount_cents ?? mb.credit
      if (!(credit > 0)) continue
      const map = ensureResa(resaId)
      if (!map.has(mb.id)) {
        map.set(mb.id, {
          mb_id: mb.id,
          credit,
          source: 'booking_payout_line',
          source_ref: bpl.mouvement_id,
          libelle: mb.libelle,
          date_operation: mb.date_operation,
        })
      }
    }

    // Chemin 5 : stripe_payout_line
    // Utilise montant_net (montant par résa dans le virement groupé Stripe), pas mb.credit (total virement)
    // Plusieurs lignes peuvent exister pour la même résa+mouvement (ex: hébergement + frais séparés) → sommer
    for (const spl of (stripePayoutRes.data || [])) {
      const mb = spl.mouvement_bancaire as any
      if (!mb?.id) continue
      const resaId = resaIdByCode[spl.reservation_code]
      if (!resaId) continue
      // montant_net = part de cette résa dans le payout Stripe (valeur CSV attribuable)
      const credit = spl.montant_net ?? mb.credit
      if (!(credit > 0)) continue
      const map = ensureResa(resaId)
      if (!map.has(mb.id)) {
        map.set(mb.id, {
          mb_id: mb.id,
          credit,
          source: 'stripe_payout_line',
          source_ref: spl.mouvement_id,
          libelle: mb.libelle,
          date_operation: mb.date_operation,
        })
      } else {
        // Plusieurs lignes stripe pour même résa+mouvement → additionner
        map.get(mb.id)!.credit += credit
      }
    }

    // ── 4. Construire allocations et anomalies ────────────────────────────────

    const allocations: Record<string, any>[] = []
    const detectedAnomalies: Record<string, any>[] = []
    let prouvees = 0
    let nonProuvees = 0

    for (const resa of resasFiltered) {
      const mbMap = linksByResa.get(resa.id)
      const links = mbMap ? [...mbMap.values()] : []

      if (links.length === 0) {
        // Annulation avec frais déjà comptabilisée via reservation_paiement → pas d'anomalie
        if (resa.final_status === 'cancelled' && cancelledWithPayment.has(resa.id)) {
          prouvees++
          continue
        }

        nonProuvees++
        detectedAnomalies.push({
          reservation_id: resa.id,
          bien_id: resa.bien_id,
          mois_comptable: mois,
          code_anomalie: 'MOUVEMENT_BANCAIRE_MISSING',
          description: (
            `Aucun mouvement bancaire rapproché (platform=${resa.platform}, ` +
            `fin_revenue=${resa.fin_revenue} ct). ` +
            `Vérifier le rapprochement via ventilation, reservation_paiement ou payout_hospitable.`
          ),
          contexte: {
            platform: resa.platform,
            fin_revenue: resa.fin_revenue,
          },
          resolu: false,
          updated_at: new Date().toISOString(),
        })
        continue
      }

      prouvees++

      // Une ligne d'allocation par mouvement_bancaire (acompte + solde = 2 lignes)
      for (const link of links) {
        const sourceLabel = {
          ventilation: `ventilation → mb ${link.mb_id}`,
          reservation_paiement: `reservation_paiement ${link.source_ref} → mb ${link.mb_id}`,
          payout_hospitable: `payout_hospitable ${link.source_ref} → mb ${link.mb_id}`,
          booking_payout_line: `booking_payout_line → mb ${link.mb_id}`,
          stripe_payout_line: `stripe_payout_line → mb ${link.mb_id}`,
        }[link.source]

        allocations.push({
          reservation_id: resa.id,
          bien_id: resa.bien_id,
          mois_comptable: mois,
          mouvement_bancaire_id: link.mb_id,
          montant_alloue: link.credit,
          preuve_niveau: 'prouve',
          mode_allocation: 'exact',
          proportional_reason: null,
          allocation_group_key: `mb:${link.mb_id}`,
          can_be_used_for_reversement: true,
          source_type: link.source,
          source_ref: link.source_ref,
          source_line_id: `mb:${link.mb_id}:r:${resa.id}`,
          justification: `${sourceLabel}, credit=${link.credit} ct${link.libelle ? ` (${link.libelle})` : ''}`,
          payout_total: null,
          payout_resa_count: null,
          computed_by: 'auto',
          updated_at: new Date().toISOString(),
        })
      }
    }

    // ── 5. Persistance allocations : DELETE auto + INSERT ─────────────────────
    const uniqueBienIds = [...new Set(resasFiltered.map(r => r.bien_id))]
    if (uniqueBienIds.length > 0) {
      const { error: delErr } = await supabase
        .from('encaissement_allocation')
        .delete()
        .eq('mois_comptable', mois)
        .eq('computed_by', 'auto')
        .in('bien_id', uniqueBienIds)
      if (delErr) throw new Error(`Erreur DELETE allocations: ${delErr.message}`)
    }

    const BATCH = 50
    let allocOk = 0
    for (let i = 0; i < allocations.length; i += BATCH) {
      const { error } = await supabase.from('encaissement_allocation').insert(allocations.slice(i, i + BATCH))
      if (error) throw new Error(`Erreur INSERT allocations batch ${i}: ${error.message}`)
      allocOk += Math.min(BATCH, allocations.length - i)
    }

    // ── 6. Persistance anomalies : DELETE + INSERT ────────────────────────────
    // DELETE scope = bien+mois (pas seulement resaIds) pour nettoyer les anomalies
    // orphelines (owner_stay, cancelled fin_revenue=0, anciennes versions).
    // On ne supprime que resolu=false — les anomalies résolues manuellement sont préservées.
    if (uniqueBienIds.length > 0) {
      const { error: delAnoErr } = await supabase
        .from('encaissement_anomalie')
        .delete()
        .eq('mois_comptable', mois)
        .eq('resolu', false)
        .in('bien_id', uniqueBienIds)
      if (delAnoErr) throw new Error(`Erreur DELETE anomalies: ${delAnoErr.message}`)

      if (detectedAnomalies.length > 0) {
        for (let i = 0; i < detectedAnomalies.length; i += BATCH) {
          const { error } = await supabase.from('encaissement_anomalie').insert(detectedAnomalies.slice(i, i + BATCH))
          if (error) throw new Error(`Erreur INSERT anomalies batch ${i}: ${error.message}`)
        }
      }
    }

    // ── 7. Résumé ──────────────────────────────────────────────────────────────
    return jsonResp({
      reservations_total: resasFiltered.length,
      prouvees,
      non_prouvees: nonProuvees,
      anomalies: detectedAnomalies.length,
      allocations_lignes: allocOk,
      message: `${prouvees} prouvées · ${nonProuvees} sans preuve · ${detectedAnomalies.length} anomalie(s)`,
    })

  } catch (err: any) {
    console.error('allocate-encaissements fatal:', err.message)
    await logError({ source: 'edge_allocate-encaissements', message: err.message, stack: err.stack })
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
