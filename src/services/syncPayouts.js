/**
 * syncPayouts.js — Synchronisation des dates de payout Airbnb via MCP Hospitable
 *
 * Pour chaque payout Airbnb DCB (IBAN 6555) dans la fenêtre temporelle :
 * - Si payout_hospitable existe + mouvement_id IS NULL → UPDATE date_payout
 * - Si payout_hospitable n'existe pas (resa créée par webhook) → INSERT + payout_reservation
 * - Si mouvement_id IS NOT NULL (déjà rapprochée) → skip
 */
import { supabase } from '../lib/supabase'
import { fetchPayoutsList, fetchPayoutDetail } from '../lib/hospitable'

const DCB_IBAN = '6555'

/**
 * Parse le code de confirmation depuis le champ details d'une transaction Hospitable.
 * Format : "Apr 7 – 12, 2026 HMXXXXXXXXXXX"
 * Le code est toujours le dernier mot.
 */
function parseCode(details) {
  if (!details) return null
  const parts = details.trim().split(/\s+/)
  const code = parts[parts.length - 1]
  return code && /^[A-Z0-9-]{5,}$/.test(code) ? code : null
}

/**
 * Synchronise les dates de payout Airbnb depuis l'API Hospitable.
 *
 * @param {Object} opts
 * @param {number} opts.monthsBack - Nombre de mois dans le passé à traiter (défaut 3)
 * @returns {Promise<{processed, updated, created, skipped, not_found, errors, details}>}
 */
export async function syncPayoutsFromHospitable({ monthsBack = 3 } = {}) {
  const log = { processed: 0, updated: 0, created: 0, skipped: 0, not_found: 0, errors: 0, details: [] }

  try {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - monthsBack)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const probe = await fetchPayoutsList({ page: 1, per_page: 100 })
    const lastPage = probe.meta?.last_page || 1

    let done = false

    for (let p = lastPage; p >= 1 && !done; p--) {
      const response = await fetchPayoutsList({ page: p, per_page: 100 })
      const payouts = (response.data || []).slice().reverse()

      for (const payout of payouts) {
        const payoutDate = payout.date?.slice(0, 10)

        if (!payoutDate || payoutDate < cutoffStr) {
          done = true
          break
        }

        if (payout.platform?.toLowerCase() !== 'airbnb') continue
        if (!payout.bank_account?.includes(DCB_IBAN)) continue

        let transactions
        try {
          const detail = await fetchPayoutDetail(payout.id)
          transactions = (detail.data?.transactions || []).filter(t => t.type === 'Reservation')
        } catch (e) {
          log.errors++
          log.details.push(`Erreur transactions payout ${payoutDate}: ${e.message}`)
          continue
        }

        for (const tx of transactions) {
          log.processed++
          const code = parseCode(tx.details)
          if (!code) {
            log.details.push(`Code non parseable: "${tx.details}"`)
            continue
          }

          // Trouver la réservation en base par code
          const { data: resa, error: resaErr } = await supabase
            .from('reservation')
            .select('id, fin_revenue, arrival_date')
            .eq('code', code)
            .maybeSingle()

          if (resaErr || !resa) {
            log.not_found++
            log.details.push(`Code non trouvé: ${code} (payout ${payoutDate})`)
            continue
          }

          const hospId = resa.id + '_airbnb_payout'

          // Vérifier si l'entrée payout_hospitable existe
          const { data: existing } = await supabase
            .from('payout_hospitable')
            .select('id, mouvement_id')
            .eq('hospitable_id', hospId)
            .maybeSingle()

          if (!existing) {
            // Entrée manquante (resa créée par webhook) → créer
            const moisComptable = payoutDate.slice(0, 7)
            const amount = tx.amount?.amount ?? resa.fin_revenue ?? null

            const { data: inserted, error: insErr } = await supabase
              .from('payout_hospitable')
              .insert({
                hospitable_id:   hospId,
                platform:        'airbnb',
                date_payout:     payoutDate,
                amount,
                mois_comptable:  moisComptable,
                statut_matching: 'en_attente',
              })
              .select('id')
              .single()

            if (insErr) {
              log.errors++
              log.details.push(`Erreur création ${code}: ${insErr.message}`)
              continue
            }

            // Créer le lien payout_reservation
            await supabase.from('payout_reservation').upsert(
              { payout_id: inserted.id, reservation_id: resa.id },
              { onConflict: 'payout_id,reservation_id', ignoreDuplicates: true }
            )

            log.created++

          } else if (existing.mouvement_id) {
            // Déjà rapprochée — ne pas toucher
            log.skipped++

          } else {
            // Existe, pas encore rapprochée → mettre à jour la date
            const { data: upd, error: updErr } = await supabase
              .from('payout_hospitable')
              .update({ date_payout: payoutDate })
              .eq('id', existing.id)
              .select('id')

            if (updErr) {
              log.errors++
              log.details.push(`Erreur update ${code}: ${updErr.message}`)
            } else if (upd?.length) {
              log.updated++
            } else {
              log.skipped++
            }
          }
        }
      }
    }
  } catch (e) {
    log.errors++
    log.details.push('Erreur globale: ' + e.message)
  }

  return log
}
