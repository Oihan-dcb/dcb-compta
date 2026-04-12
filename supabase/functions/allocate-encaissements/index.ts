/**
 * Edge Function — allocate-encaissements
 *
 * Calcule et persiste les allocations d'encaissement par réservation/bien/mois.
 * Source de vérité : table encaissement_allocation.
 *
 * Règle absolue :
 *   - fin_revenue n'est JAMAIS une preuve d'encaissement
 *   - aucun fallback silencieux
 *   - hiérarchie stricte : exact > proportional > manual
 *   - can_be_used_for_reversement = false si preuve_niveau = 'approxime'
 *
 * Canaux traités :
 *   Airbnb/Booking → payout_reservation → payout_hospitable → mouvement_bancaire
 *   Direct/Stripe  → reservation_paiement → mouvement_bancaire
 *
 * Body attendu : { mois: "YYYY-MM" }
 * Retourne : { reservations_total, prouvees, approximees, non_prouvees, anomalies }
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

    // ── 1. Réservations du mois comptable ────────────────────────────────────
    // Base : mois_comptable = mois (la date de la résa compte, pas celle du virement)
    // Exclusions : annulées, owner_stay, fin_revenue = 0
    const { data: resas, error: resasErr } = await supabase
      .from('reservation')
      .select('id, bien_id, fin_revenue, platform, mois_comptable')
      .eq('mois_comptable', mois)
      .eq('owner_stay', false)
      .neq('final_status', 'cancelled')
      .gt('fin_revenue', 0)

    if (resasErr) throw resasErr
    if (!resas?.length) {
      return jsonResp({ reservations_total: 0, prouvees: 0, approximees: 0, non_prouvees: 0, anomalies: 0, message: 'Aucune réservation pour ce mois' })
    }

    const resaIds = resas.map(r => r.id)
    const resaById: Record<string, { id: string; bien_id: string; fin_revenue: number; platform: string }> = {}
    for (const r of resas) resaById[r.id] = r

    const allocations: Record<string, any>[] = []
    const detectedAnomalies: { reservation_id: string; bien_id: string; code_anomalie: string; description: string; contexte: object }[] = []
    const resasTraitees = new Set<string>()

    // ── 2. Canal Airbnb/Booking via chaîne payout ────────────────────────────
    const { data: payoutResas } = await supabase
      .from('payout_reservation')
      .select(`
        payout_id,
        reservation_id,
        payout_hospitable!inner(id, mouvement_id, amount, mouvement_bancaire(id, credit))
      `)
      .in('reservation_id', resaIds)

    if (payoutResas?.length) {
      // Regrouper par payout_hospitable.id
      const payoutMap: Record<string, {
        ph: { id: string; mouvement_id: string | null; amount: number | null; mouvement_bancaire: { id: string; credit: number } | null }
        payout_id: string
        targetResaIds: string[]
      }> = {}

      for (const pr of payoutResas) {
        const ph = pr.payout_hospitable as any
        if (!ph) {
          const resa = resaById[pr.reservation_id]
          if (resa) {
            detectedAnomalies.push({
              reservation_id: pr.reservation_id,
              bien_id: resa.bien_id,
              code_anomalie: 'PAYOUT_HOSPITABLE_MISSING',
              description: `payout_reservation trouvé (payout_id=${pr.payout_id}) mais payout_hospitable absent`,
              contexte: { payout_id: pr.payout_id },
            })
          }
          continue
        }
        const phId = ph.id
        if (!payoutMap[phId]) {
          payoutMap[phId] = { ph, payout_id: pr.payout_id, targetResaIds: [] }
        }
        payoutMap[phId].targetResaIds.push(pr.reservation_id)
      }

      // Récupérer TOUTES les réservations de chaque payout (dénominateur proportionnel correct)
      const allPayoutIds = [...new Set(Object.values(payoutMap).map(p => p.payout_id))]
      const { data: allPayoutResas } = await supabase
        .from('payout_reservation')
        .select('payout_id, reservation_id, reservation!inner(id, bien_id, fin_revenue)')
        .in('payout_id', allPayoutIds)

      // Index : payout_id → toutes ses réservations
      const allResasByPayoutId: Record<string, Array<{ reservation_id: string; bien_id: string; fin_revenue: number }>> = {}
      const seenPR = new Set<string>()
      for (const pr of (allPayoutResas || [])) {
        const key = `${pr.payout_id}:${pr.reservation_id}`
        if (seenPR.has(key)) continue
        seenPR.add(key)
        const r = pr.reservation as any
        if (!r) continue
        if (!allResasByPayoutId[pr.payout_id]) allResasByPayoutId[pr.payout_id] = []
        allResasByPayoutId[pr.payout_id].push({
          reservation_id: pr.reservation_id,
          bien_id: r.bien_id,
          fin_revenue: r.fin_revenue || 0,
        })
      }

      // Traiter chaque payout
      for (const [phId, { ph, payout_id, targetResaIds }] of Object.entries(payoutMap)) {
        const mb = ph.mouvement_bancaire as any
        const hasBankLink = ph.mouvement_id != null && mb?.id != null && mb?.credit != null
        const credit: number = hasBankLink ? mb.credit : (ph.amount ?? 0)

        if (!credit) {
          for (const rid of targetResaIds) {
            const resa = resaById[rid]
            if (!resa) continue
            detectedAnomalies.push({
              reservation_id: rid,
              bien_id: resa.bien_id,
              code_anomalie: 'PAYOUT_SANS_MONTANT',
              description: `payout_hospitable ${phId} sans montant (mouvement_id=null et amount=null)`,
              contexte: { payout_hospitable_id: phId, payout_id },
            })
          }
          continue
        }

        // Si mouvement_id null : c'est une anomalie, mais on peut quand même allouer en approxime
        if (!hasBankLink) {
          for (const rid of targetResaIds) {
            const resa = resaById[rid]
            if (!resa) continue
            detectedAnomalies.push({
              reservation_id: rid,
              bien_id: resa.bien_id,
              code_anomalie: 'MOUVEMENT_ID_NULL',
              description: `payout_hospitable ${phId} : mouvement_id non renseigné — encaissement approximé depuis payout.amount=${ph.amount} ct. Rattacher le mouvement bancaire pour passer en "prouvé".`,
              contexte: { payout_hospitable_id: phId, payout_id, amount: ph.amount },
            })
          }
        }

        const allResasOfPayout = allResasByPayoutId[payout_id] || []
        const totalRev = allResasOfPayout.reduce((s, r) => s + r.fin_revenue, 0)
        const isMultiResa = allResasOfPayout.length > 1

        for (const rid of targetResaIds) {
          const resa = resaById[rid]
          if (!resa) continue

          // Hiérarchie : exact si payout mono-résa, proportional sinon
          let modeAllocation: string
          let montant: number
          let proportionalReason: string | null = null

          if (!isMultiResa) {
            // exact : le payout ne couvre qu'une seule réservation
            modeAllocation = 'exact'
            montant = credit
          } else {
            // proportional : seul mode disponible pour les multi-réservations
            modeAllocation = 'proportional'
            const thisRev = resa.fin_revenue || 0
            montant = totalRev > 0
              ? Math.round(credit * thisRev / totalRev)
              : Math.round(credit / allResasOfPayout.length)
            proportionalReason = (
              `Payout ${phId} regroupe ${allResasOfPayout.length} réservations ` +
              `(fin_revenue total=${totalRev} ct) — ` +
              `cette résa contribue ${thisRev}/${totalRev} = ` +
              `${totalRev > 0 ? Math.round(thisRev / totalRev * 10000) / 100 : 'N/A'}%`
            )
          }

          if (montant <= 0) continue

          allocations.push({
            reservation_id: rid,
            bien_id: resa.bien_id,
            mois_comptable: mois,
            mouvement_bancaire_id: hasBankLink ? mb.id : null,
            montant_alloue: montant,
            preuve_niveau: hasBankLink ? 'prouve' : 'approxime',
            mode_allocation: modeAllocation,
            proportional_reason: proportionalReason,
            allocation_group_key: `payout:${phId}`,
            can_be_used_for_reversement: hasBankLink,
            source_type: 'payout_hospitable',
            source_ref: phId,
            source_line_id: `ph:${phId}:r:${rid}`,
            justification: hasBankLink
              ? `Payout rapproché — mouvement_bancaire ${mb.id}, credit=${mb.credit} ct`
              : `Payout non rapproché — montant estimé depuis payout_hospitable.amount=${ph.amount} ct`,
            payout_total: credit,
            payout_resa_count: allResasOfPayout.length,
            computed_by: 'auto',
            updated_at: new Date().toISOString(),
          })
          resasTraitees.add(rid)
        }
      }
    }

    // Anomalies pour réservations Airbnb/Booking sans payout_reservation
    const resasAvecPayoutResa = new Set((payoutResas || []).map(pr => pr.reservation_id))
    for (const resa of resas) {
      const isAirbnbChannel = resa.platform !== 'direct' && resa.platform !== 'other'
      if (isAirbnbChannel && !resasAvecPayoutResa.has(resa.id)) {
        detectedAnomalies.push({
          reservation_id: resa.id,
          bien_id: resa.bien_id,
          code_anomalie: 'PAYOUT_MISSING',
          description: `Réservation ${resa.platform} sans payout_reservation (fin_revenue=${resa.fin_revenue} ct)`,
          contexte: { reservation_id: resa.id, platform: resa.platform, fin_revenue: resa.fin_revenue },
        })
      }
    }

    // ── 3. Canal Direct / Stripe via reservation_paiement ────────────────────
    const resasSansPayout = resas.filter(r => !resasTraitees.has(r.id))

    if (resasSansPayout.length > 0) {
      const { data: resPaiements } = await supabase
        .from('reservation_paiement')
        .select('id, reservation_id, mouvement_id, type_paiement, montant, mouvement_bancaire(id, credit)')
        .in('reservation_id', resasSansPayout.map(r => r.id))

      const rpByResa: Record<string, any[]> = {}
      for (const rp of (resPaiements || [])) {
        if (!rpByResa[rp.reservation_id]) rpByResa[rp.reservation_id] = []
        rpByResa[rp.reservation_id].push(rp)
      }

      for (const resa of resasSansPayout) {
        const paiements = rpByResa[resa.id] || []

        if (paiements.length === 0) {
          detectedAnomalies.push({
            reservation_id: resa.id,
            bien_id: resa.bien_id,
            code_anomalie: 'RESERVATION_PAIEMENT_MISSING',
            description: `Réservation directe sans paiement enregistré (platform=${resa.platform}, fin_revenue=${resa.fin_revenue} ct). Rattacher un mouvement bancaire via reservation_paiement.`,
            contexte: { reservation_id: resa.id, platform: resa.platform, fin_revenue: resa.fin_revenue },
          })
          continue
        }

        let anyAllocated = false
        for (const rp of paiements) {
          const mb = rp.mouvement_bancaire as any
          const isLinked = rp.mouvement_id != null && mb?.id != null && mb?.credit != null
          const credit: number = mb?.credit ?? 0

          if (!isLinked || credit <= 0) {
            detectedAnomalies.push({
              reservation_id: resa.id,
              bien_id: resa.bien_id,
              code_anomalie: 'RESERVATION_PAIEMENT_NOT_LINKED',
              description: (
                rp.mouvement_id == null
                  ? `Paiement (id=${rp.id}, montant=${rp.montant} ct, type=${rp.type_paiement}) sans mouvement_id — aucune preuve bancaire`
                  : `Paiement (id=${rp.id}) lié à mouvement ${rp.mouvement_id} mais credit=null ou 0`
              ),
              contexte: { reservation_paiement_id: rp.id, type_paiement: rp.type_paiement, montant: rp.montant, mouvement_id: rp.mouvement_id },
            })
            // Pas d'allocation — fin_revenue ne peut pas compenser
            continue
          }

          allocations.push({
            reservation_id: resa.id,
            bien_id: resa.bien_id,
            mois_comptable: mois,
            mouvement_bancaire_id: mb.id,
            montant_alloue: credit,
            preuve_niveau: 'prouve',
            mode_allocation: 'exact',
            proportional_reason: null,
            allocation_group_key: `direct:mb:${mb.id}`,
            can_be_used_for_reversement: true,
            source_type: 'reservation_paiement',
            source_ref: rp.id,
            source_line_id: `rp:${rp.id}`,
            justification: `Paiement direct rapproché — mouvement_bancaire ${mb.id}, credit=${credit} ct, type=${rp.type_paiement}`,
            payout_total: null,
            payout_resa_count: null,
            computed_by: 'auto',
            updated_at: new Date().toISOString(),
          })
          anyAllocated = true
          resasTraitees.add(resa.id)
        }
      }
    }

    // ── 4. UPSERT allocations (idempotent sur source_line_id) ────────────────
    let allocOk = 0
    const BATCH = 50
    for (let i = 0; i < allocations.length; i += BATCH) {
      const batch = allocations.slice(i, i + BATCH)
      const { error } = await supabase
        .from('encaissement_allocation')
        .upsert(batch, { onConflict: 'source_line_id', ignoreDuplicates: false })
      if (error) {
        console.error('UPSERT allocation error:', JSON.stringify(error))
        throw new Error(`Erreur UPSERT allocations batch ${i}: ${error.message}`)
      }
      allocOk += batch.length
    }

    // ── 5. UPSERT anomalies + auto-résolution des anomalies disparues ────────
    // Récupérer les anomalies non résolues existantes pour ce mois
    const { data: existingAnomalies } = await supabase
      .from('encaissement_anomalie')
      .select('id, reservation_id, code_anomalie')
      .eq('mois_comptable', mois)
      .eq('resolu', false)

    const newAnomalieKeys = new Set(detectedAnomalies.map(a => `${a.reservation_id}:${a.code_anomalie}`))

    // Auto-résoudre les anomalies qui n'existent plus
    const toResolve = (existingAnomalies || []).filter(
      ea => !newAnomalieKeys.has(`${ea.reservation_id}:${ea.code_anomalie}`)
    )
    if (toResolve.length > 0) {
      await supabase
        .from('encaissement_anomalie')
        .update({ resolu: true, resolu_at: new Date().toISOString(), resolu_note: 'Auto-résolu — problème détecté corrigé depuis dernier calcul', updated_at: new Date().toISOString() })
        .in('id', toResolve.map(a => a.id))
    }

    // Upsert nouvelles anomalies
    if (detectedAnomalies.length > 0) {
      const anomalieRows = detectedAnomalies.map(a => ({
        ...a,
        resolu: false,
        updated_at: new Date().toISOString(),
      }))
      const { error: anomErr } = await supabase
        .from('encaissement_anomalie')
        .upsert(anomalieRows, { onConflict: 'reservation_id,code_anomalie', ignoreDuplicates: false })
      if (anomErr) console.error('UPSERT anomalies error:', JSON.stringify(anomErr))
    }

    // ── 6. Résumé ─────────────────────────────────────────────────────────────
    const prouvees = allocations.filter(a => a.preuve_niveau === 'prouve').length
    const approximees = allocations.filter(a => a.preuve_niveau === 'approxime').length
    const nonProuvees = resas.length - resasTraitees.size

    return jsonResp({
      reservations_total: resas.length,
      prouvees,
      approximees,
      non_prouvees: nonProuvees,
      anomalies: detectedAnomalies.length,
      auto_resolues: toResolve.length,
      message: `${prouvees} prouvées · ${approximees} approximées · ${nonProuvees} sans preuve · ${detectedAnomalies.length} anomalie(s)`,
    })

  } catch (err: any) {
    console.error('allocate-encaissements fatal:', err.message)
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
