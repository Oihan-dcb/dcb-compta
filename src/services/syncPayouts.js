/**
 * syncPayouts.js — Synchronisation des dates de payout Airbnb via MCP Hospitable
 *
 * ⚠️ DUPLICATION CONTRÔLÉE : api/sync-payouts.js (cron nightly 3h30, les deux agences)
 * porte la même logique métier côté serveur. Toute modification ici (payouts réels,
 * résolutions/ajustements, payouts fractionnés) doit y être répercutée — et vice-versa.
 *
 * Pour chaque payout Airbnb DCB (IBAN 6555) dans la fenêtre temporelle :
 * - Si payout_hospitable existe + mouvement_id IS NULL → UPDATE date_payout
 * - Si payout_hospitable n'existe pas (resa créée par webhook) → INSERT + payout_reservation
 * - Si mouvement_id IS NOT NULL (déjà rapprochée) → skip
 */
import { supabase } from '../lib/supabase'
import { fetchPayoutsList, fetchPayoutDetail } from '../lib/hospitable'

/**
 * Version serveur (recommandée pour l'UI) : délègue à /api/sync-payouts — rapide
 * (transactions incluses dans la liste, écritures en batch) et couvre les 2 agences.
 * La version client `syncPayoutsFromHospitable` ci-dessous reste en secours
 * (1 appel API par payout via le proxy → lente, plusieurs minutes).
 */
export async function syncPayoutsServer(monthsBack = 3) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expirée')
  const res = await fetch(`/api/sync-payouts?monthsBack=${monthsBack}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token },
  })
  let log
  try { log = await res.json() } catch { throw new Error(`Réponse invalide du serveur (${res.status})`) }
  if (!res.ok) throw new Error(log?.error || `Erreur serveur ${res.status}`)
  return log
}

// Suffixe IBAN configuré par déploiement (ex: '6555' pour DCB, '1234' pour Lauian)
// Si absent, on ne filtre pas par IBAN (prend tous les payouts Airbnb)
const IBAN_SUFFIX = import.meta.env.VITE_AIRBNB_IBAN || null

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
        if (IBAN_SUFFIX && !payout.bank_account?.includes(IBAN_SUFFIX)) continue

        let transactions, autresTxs
        try {
          const detail = await fetchPayoutDetail(payout.id)
          const allTxs = detail.data?.transactions || []
          transactions = allTxs.filter(t => t.type === 'Reservation')
          // Résolutions Airbnb (recouches facturées via le centre de résolution, dédommagements
          // AirCover) et ajustements (retenue sur le virement pour un remboursement passé) :
          // ils font partie du TOTAL viré en banque, il faut les stocker pour rapprocher.
          autresTxs = allTxs.filter(t => !['Reservation', 'Payout'].includes(t.type))
        } catch (e) {
          log.errors++
          log.details.push(`Erreur transactions payout ${payoutDate}: ${e.message}`)
          continue
        }

        // Payout réel à stocker si : ajustements/résolutions présents, ou payout fractionné
        // (2e versement d'une résa dont la ligne synthétique porte déjà un autre montant)
        let needsRealRow = autresTxs.length > 0
        const resasDuPayout = []   // { resa, txAmount } — pour les liens payout_reservation

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
          resasDuPayout.push({ resa, txAmount: tx.amount?.amount ?? null })

          // Vérifier si l'entrée payout_hospitable existe
          const { data: existing } = await supabase
            .from('payout_hospitable')
            .select('id, mouvement_id, amount')
            .eq('hospitable_id', hospId)
            .maybeSingle()

          // Payout fractionné : la ligne synthétique porte un autre montant que cette
          // transaction → Airbnb a versé cette résa en plusieurs fois (ex. 272,09 € = 97,18 + 174,91)
          if (existing && existing.amount != null && tx.amount?.amount != null && existing.amount !== tx.amount.amount) {
            needsRealRow = true
          }

          if (!existing) {
            // Entrée manquante (resa créée par webhook) → créer
            const moisComptable = payoutDate.slice(0, 7)
            const amount = tx.amount?.amount ?? resa.fin_revenue ?? null

            const { data: inserted, error: insErr } = await supabase
              .from('payout_hospitable')
              .insert({
                hospitable_id:   hospId,
                platform:        'airbnb',
                platform_id:     payout.platform_id ?? null,
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
              .update({ date_payout: payoutDate, platform_id: payout.platform_id ?? null })
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

        // ── Payout réel (résolutions / ajustements / fractionné) ──────────────
        // Stocké avec le TOTAL bancaire du payout (hospitable_id = uuid du payout) et une
        // référence lisible ; c'est lui que le matching rapprochera en exact du mouvement.
        // Les recouches (Resolution Payout) n'ont pas de résa — la référence porte le détail.
        if (needsRealRow) {
          const { data: realExisting } = await supabase
            .from('payout_hospitable')
            .select('id, mouvement_id')
            .eq('hospitable_id', payout.id)
            .maybeSingle()

          if (!realExisting) {
            const fmtE = (c) => (c / 100).toFixed(2) + '€'
            const reference = (autresTxs.length
              ? autresTxs.map(t => `${t.type}: ${t.details} (${fmtE(t.amount?.amount ?? 0)})`).join(' | ')
              : 'Payout fractionné : ' + transactions.map(t => parseCode(t.details)).filter(Boolean).join(', ')
            ).slice(0, 500)

            const { data: inserted, error: insErr } = await supabase
              .from('payout_hospitable')
              .insert({
                hospitable_id:   payout.id,
                platform:        'airbnb',
                platform_id:     payout.platform_id ?? null,
                date_payout:     payoutDate,
                amount:          payout.amount?.amount ?? null,
                mois_comptable:  payoutDate.slice(0, 7),
                statut_matching: 'en_attente',
                reference,
              })
              .select('id')
              .single()

            if (insErr) {
              log.errors++
              log.details.push(`Erreur payout réel ${payoutDate}: ${insErr.message}`)
            } else {
              for (const { resa, txAmount } of resasDuPayout) {
                await supabase.from('payout_reservation').upsert(
                  { payout_id: inserted.id, reservation_id: resa.id, amount_cents: txAmount },
                  { onConflict: 'payout_id,reservation_id', ignoreDuplicates: false }
                )
              }
              log.created++
              log.details.push(`Payout réel ${payoutDate} ${fmtE(payout.amount?.amount ?? 0)} stocké (${reference.slice(0, 90)})`)
            }
          } else if (realExisting.mouvement_id) {
            log.skipped++
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
