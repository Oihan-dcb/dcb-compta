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
  source: 'ventilation' | 'reservation_paiement' | 'payout_hospitable'
  source_ref: string   // mouvement_id (ventilation), rp.id, ph.id
  libelle?: string
  date_operation?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { mois } = await req.json()
    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
      throw new Error('mois invalide — format YYYY-MM attendu')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )

    // ── 1. Réservations du mois ───────────────────────────────────────────────
    const { data: resas, error: resasErr } = await supabase
      .from('reservation')
      .select('id, bien_id, fin_revenue, platform, mois_comptable')
      .eq('mois_comptable', mois)
      .eq('owner_stay', false)
      .neq('final_status', 'cancelled')
      .gt('fin_revenue', 0)

    if (resasErr) throw resasErr
    if (!resas?.length) {
      return jsonResp({
        reservations_total: 0, prouvees: 0, non_prouvees: 0, anomalies: 0,
        message: 'Aucune réservation pour ce mois',
      })
    }

    const resaIds = resas.map(r => r.id)
    const resaById: Record<string, typeof resas[0]> = {}
    for (const r of resas) resaById[r.id] = r

    // ── 2. Récupérer tous les liens bancaires en parallèle ────────────────────

    const [ventilationRes, rpRes, payoutRes] = await Promise.all([

      // Chemin 1 : ventilation
      supabase
        .from('ventilation')
        .select('reservation_id, mouvement_id, mouvement_bancaire(id, credit, libelle, date_operation)')
        .in('reservation_id', resaIds)
        .not('mouvement_id', 'is', null),

      // Chemin 2 : reservation_paiement
      supabase
        .from('reservation_paiement')
        .select('id, reservation_id, mouvement_id, mouvement_bancaire(id, credit, libelle, date_operation)')
        .in('reservation_id', resaIds)
        .not('mouvement_id', 'is', null),

      // Chemin 3 : payout_hospitable (via payout_reservation)
      supabase
        .from('payout_reservation')
        .select('reservation_id, payout_hospitable!inner(id, mouvement_id, mouvement_bancaire(id, credit, libelle, date_operation))')
        .in('reservation_id', resaIds),
    ])

    if (ventilationRes.error) throw new Error(`Erreur ventilation: ${ventilationRes.error.message}`)
    if (rpRes.error) throw new Error(`Erreur reservation_paiement: ${rpRes.error.message}`)
    if (payoutRes.error) throw new Error(`Erreur payout_reservation: ${payoutRes.error.message}`)

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
    for (const rp of (rpRes.data || [])) {
      const mb = rp.mouvement_bancaire as any
      if (!mb?.id || !(mb.credit > 0)) continue
      const map = ensureResa(rp.reservation_id)
      if (!map.has(mb.id)) {
        map.set(mb.id, {
          mb_id: mb.id,
          credit: mb.credit,
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

    // ── 4. Construire allocations et anomalies ────────────────────────────────

    const allocations: Record<string, any>[] = []
    const detectedAnomalies: Record<string, any>[] = []
    let prouvees = 0
    let nonProuvees = 0

    for (const resa of resas) {
      const mbMap = linksByResa.get(resa.id)
      const links = mbMap ? [...mbMap.values()] : []

      if (links.length === 0) {
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
    const uniqueBienIds = [...new Set(resas.map(r => r.bien_id))]
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

    // ── 6. Persistance anomalies : DELETE toutes + INSERT ─────────────────────
    if (resaIds.length > 0) {
      const { error: delAnoErr } = await supabase
        .from('encaissement_anomalie')
        .delete()
        .in('reservation_id', resaIds)
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
      reservations_total: resas.length,
      prouvees,
      non_prouvees: nonProuvees,
      anomalies: detectedAnomalies.length,
      allocations_lignes: allocOk,
      message: `${prouvees} prouvées · ${nonProuvees} sans preuve · ${detectedAnomalies.length} anomalie(s)`,
    })

  } catch (err: any) {
    console.error('allocate-encaissements fatal:', err.message)
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
