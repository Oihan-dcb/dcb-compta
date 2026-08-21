/**
 * Edge Function — ventilation-auto
 *
 * Port serveur de src/services/ventilation.js
 * Calcule et sauvegarde la ventilation pour tous les mois ouverts non clôturés.
 *
 * Body accepté : { mois?: "YYYY-MM", agence?: string, dry_run?: boolean }
 *   - mois    : forcer un mois spécifique (sinon : auto-détection mois ouverts)
 *   - agence  : défaut 'dcb'
 *   - dry_run : si true, calcule sans écrire en base
 *
 * Appelé par pg_cron chaque nuit via net.http_post.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logError } from '../_shared/logError.ts'
// Noyau partagé (Étape 4, audit fusion des moteurs, 21/08/2026) — Deno importe le .js ESM
// nativement, aucune transpilation nécessaire. Source unique avec api/ventiler.js (Vercel)
// et src/services/ventilation.js (navigateur) : plus de divergence possible entre les 3.
import { TVA_RATE, STATUTS_NON_VENTILABLES, ligneTVA, ligneHorsTVA, _calculerLignes } from '../../../src/services/ventilationCore.js'

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

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUTS_VERROU_FACTURE = ['envoye_evoliz']

// ── Types ─────────────────────────────────────────────────────────────────────

interface Fee { label: string; amount: number; fee_type: string }
interface Bien {
  id: string
  proprietaire_id: string
  agence: string | null
  provision_ae_ref: number
  forfait_dcb_ref: number
  has_ae: boolean
  taux_commission_override: number | null
  gestion_loyer: boolean | null
  skip_facturation: boolean | null
  proprietaire: { id: string; taux_commission: number | null } | null
}
interface Resa {
  id: string
  code: string
  platform: string
  final_status: string
  fin_revenue: number
  fin_accommodation: number | null
  fin_discount: number | null
  mois_comptable: string
  arrival_date: string
  departure_date: string
  guest_name: string | null
  owner_stay: boolean
  bien_id: string
  bien: Bien | null
  reservation_fee: Fee[]
  reservation_ajustement: { montant: number; type: string | null; statut: string; montant_fmen: number | null; montant_auto: number | null }[]
  hospitable_raw: Record<string, unknown> | null
  isProlongation?: boolean
  originalResaId?: string | null
}
interface LigneVentilation {
  reservation_id: string
  bien_id: string
  proprietaire_id: string
  code: string
  libelle: string
  montant_ht: number
  taux_tva: number
  montant_tva: number
  montant_ttc: number
  mois_comptable: string
  calcul_source: string
  taux_calcule: number | null
}

// ── Détection ajustements Hospitable (Resolution Center) — voir migration 222 ─
// Insère les nouveaux ajustements en statut 'a_qualifier' sans écraser une qualification
// existante (contrainte unique + ignoreDuplicates). _calculerLignes ne prend en compte
// que les lignes statut='traite'.

async function _detecterAjustements(resa: Resa, supa: ReturnType<typeof createClient>): Promise<void> {
  const fin = ((resa.hospitable_raw as Record<string, unknown>)?.financials as Record<string, unknown>)?.host as Record<string, unknown> | undefined
  const rawAdjustments = (fin?.adjustments as { label: string; amount: number }[]) || []
  const rows = rawAdjustments
    .filter(a => (a.amount || 0) !== 0)
    .map(a => ({
      reservation_id: resa.id,
      mois_comptable: resa.mois_comptable,
      montant: a.amount,
      label: a.label || null,
    }))
  if (rows.length === 0) return
  await supa.from('reservation_ajustement').upsert(rows, { onConflict: 'reservation_id,label,montant', ignoreDuplicates: true })
}

// ── calculerVentilationResa (port avec supabase admin) ────────────────────────

// Résultat de comparaison retourné par calculerVentilationResa — shape minimale (pas de
// reservation_id/bien_id/libelle/mois_comptable) pour le harnais de non-régression (Étape 3,
// audit fusion des moteurs 21/08/2026). `null` = aucune décision de ventilation prise pour
// cette résa (cas revenue=0, ni owner_stay ni annulée) ; sinon tableau des lignes attendues,
// éventuellement vide (ex. annulée sans payout).
type LigneComparable = { code: string; montant_ht: number; montant_tva: number; montant_ttc: number }
const toComparable = (l: LigneVentilation): LigneComparable =>
  ({ code: l.code, montant_ht: l.montant_ht, montant_tva: l.montant_tva, montant_ttc: l.montant_ttc })

async function calculerVentilationResa(resa: Resa, agence: string, supa: ReturnType<typeof createClient>, dryRun: boolean): Promise<LigneComparable[] | null> {
  // Verrou ajustement manuel (migration 226) : ventilation saisie à la main dans le
  // modal Réservations — ne JAMAIS l'écraser par le recalcul nightly.
  if ((resa as { ventilation_manuelle?: boolean }).ventilation_manuelle) return null

  const bien = resa.bien!

  // Séjour propriétaire
  if (resa.owner_stay) {
    const men = resa.fin_revenue || 0
    const autoHT = bien.provision_ae_ref || 0
    const fmenTTC = Math.max(0, men - autoHT)
    const fmenHT = Math.round(fmenTTC / (1 + TVA_RATE))
    const fmenTVA = fmenTTC - fmenHT

    const lignesOwnerStay: LigneVentilation[] = []
    if (fmenTTC > 0) lignesOwnerStay.push(ligneTVA('FMEN', 'Forfait ménage séjour propriétaire', fmenHT, bien, resa, null, fmenTTC))
    // Ligne AUTO même à 0 (provision_ae_ref absent = info manquante, pas coût nul)
    if (men > 0) lignesOwnerStay.push(ligneHorsTVA('AUTO', 'Débours auto-entrepreneur', autoHT, bien, resa))

    if (!dryRun) {
      const { data: existingAutoReel } = await supa.from('ventilation').select('montant_reel').eq('reservation_id', resa.id).eq('code', 'AUTO').maybeSingle()
      const autoReel = existingAutoReel?.montant_reel ?? null
      await supa.from('ventilation').delete().eq('reservation_id', resa.id)
      if (lignesOwnerStay.length > 0) { const { error } = await supa.from('ventilation').insert(lignesOwnerStay); if (error) throw error }
      if (autoReel !== null && men > 0) await supa.from('ventilation').update({ montant_reel: autoReel }).eq('reservation_id', resa.id).eq('code', 'AUTO')
      await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
      const { data: ligneAuto } = await supa.from('ventilation').select('id').eq('reservation_id', resa.id).eq('code', 'AUTO').single()
      if (ligneAuto?.id) { try { await supa.rpc('lier_ventilation_auto_mission', { p_reservation_id: resa.id, p_ventilation_id: ligneAuto.id }) } catch {} }
    }
    return lignesOwnerStay.map(toComparable)
  }

  // Annulée sans payout
  const isCancelled = STATUTS_NON_VENTILABLES.includes(resa.final_status)
  if (isCancelled && parseFloat(String(resa.fin_revenue || 0)) === 0) {
    if (!dryRun) {
      await supa.from('ventilation').delete().eq('reservation_id', resa.id)
      await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    }
    return []
  }

  const revenue = resa.fin_revenue || 0
  if (revenue === 0) {
    if (!dryRun) await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return null
  }

  if (!dryRun) await _detecterAjustements(resa, supa)

  const { lignes, isProlongation } = _calculerLignes(resa, agence)

  if (dryRun) return lignes.map(toComparable)

  // Sauvegarder montant_reel + mouvement_id avant suppression
  const { data: existingLines } = await supa.from('ventilation').select('id, code, montant_ht, montant_tva, montant_ttc, montant_reel, mouvement_id').eq('reservation_id', resa.id)
  const existingReels: Record<string, number> = {}
  const existingMouvements: Record<string, string> = {}
  for (const l of existingLines || []) {
    if (l.montant_reel != null) existingReels[l.code] = l.montant_reel
    if (l.mouvement_id != null) existingMouvements[l.code] = l.mouvement_id
  }

  // Idempotence : si le recalcul produit exactement les mêmes lignes (codes + montants)
  // que ce qui existe déjà, ne rien toucher — évite un DELETE+INSERT inutile à chaque
  // webhook/cron. Incident 06/08/2026 : ~115k écritures ventilation/semaine pour des
  // valeurs identiques, avec au passage des mission_menage.ventilation_auto_id cassés
  // (FK ON DELETE SET NULL, migration 002) à chaque cycle.
  const ligneKey = (c: string, ht: number, tva: number, ttc: number) => `${c}|${ht}|${tva}|${ttc}`
  const existingKeySet = new Set((existingLines || []).map(l => ligneKey(l.code, l.montant_ht, l.montant_tva, l.montant_ttc)))
  const sameLignes = (existingLines || []).length === lignes.length
    && lignes.every(l => existingKeySet.has(ligneKey(l.code, l.montant_ht, l.montant_tva, l.montant_ttc)))
  if (sameLignes) {
    await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)
    return lignes.map(toComparable)
  }

  // Migration mission_menage si prolongation
  let missionToMigrate: string | null = null
  let autoMontantReel: number | null = null
  if (isProlongation) {
    const existingAuto = (existingLines || []).find(l => l.code === 'AUTO')
    if (existingAuto) {
      autoMontantReel = existingAuto.montant_reel
      const { data: mission } = await supa.from('mission_menage').select('id').eq('ventilation_auto_id', existingAuto.id).maybeSingle()
      missionToMigrate = mission?.id || null
    }
  }

  const { error: delErr } = await supa.from('ventilation').delete().eq('reservation_id', resa.id)
  if (delErr) throw new Error(`DELETE ventilation: ${delErr.message}`)

  if (lignes.length > 0) { const { error } = await supa.from('ventilation').insert(lignes); if (error) throw error }

  // Restaurer montant_reel + mouvement_id
  const codesToRestore = new Set([...Object.keys(existingReels), ...Object.keys(existingMouvements)])
  if (isProlongation) codesToRestore.delete('AUTO')
  for (const code of codesToRestore) {
    const patch: Record<string, unknown> = {}
    if (existingReels[code] != null) patch.montant_reel = existingReels[code]
    if (existingMouvements[code] != null) patch.mouvement_id = existingMouvements[code]
    if (Object.keys(patch).length > 0) await supa.from('ventilation').update(patch).eq('reservation_id', resa.id).eq('code', code)
  }

  await supa.from('reservation').update({ ventilation_calculee: true }).eq('id', resa.id)

  // Migration prolongation
  if (isProlongation && missionToMigrate) {
    let originalResaId = resa.originalResaId || null
    if (!originalResaId) {
      const { data: originalResa } = await supa.from('reservation').select('id')
        .eq('bien_id', resa.bien_id).eq('departure_date', (resa.arrival_date || '').substring(0, 10)).neq('id', resa.id).maybeSingle()
      originalResaId = originalResa?.id || null
    }
    if (originalResaId) {
      const { data: originalAuto } = await supa.from('ventilation').select('id').eq('reservation_id', originalResaId).eq('code', 'AUTO').maybeSingle()
      if (originalAuto?.id) {
        await supa.from('mission_menage').update({ ventilation_auto_id: originalAuto.id }).eq('id', missionToMigrate)
        if (autoMontantReel != null) await supa.from('ventilation').update({ montant_reel: autoMontantReel }).eq('id', originalAuto.id)
      }
    }
  }

  // Lier mission_menage AUTO
  const { data: ligneAuto } = await supa.from('ventilation').select('id').eq('reservation_id', resa.id).eq('code', 'AUTO').single()
  if (ligneAuto?.id) { try { await supa.rpc('lier_ventilation_auto_mission', { p_reservation_id: resa.id, p_ventilation_id: ligneAuto.id }) } catch {} }

  return lignes.map(toComparable)
}

// ── calculerVentilationMois ────────────────────────────────────────────────────

async function calculerVentilationMois(mois: string, agence: string, supa: ReturnType<typeof createClient>, dryRun: boolean) {
  // Verrou factures
  const { data: facturesVerrouillees } = await supa.from('facture_evoliz')
    .select('proprietaire_id').eq('mois', mois).eq('type_facture', 'honoraires').in('statut', STATUTS_VERROU_FACTURE)
  const proprietairesVerrouilles = new Set((facturesVerrouillees || []).map((f: { proprietaire_id: string }) => f.proprietaire_id).filter(Boolean))

  // Supprimer ventilations orphelines
  // ventilation_manuelle=false obligatoire : une ligne verrouillée manuellement (saisie humaine,
  // ex. COM sur annulation avec paiement partiellement conservé) ne doit jamais être effacée par
  // ce nettoyage automatique (cf. incident HOST-EIEADC/408P, 06/08/2026, I-127).
  const { data: resasCancelleesIds } = await supa.from('reservation').select('id')
    .eq('mois_comptable', mois)
    .eq('ventilation_manuelle', false)
    .in('final_status', ['cancelled', 'not_accepted', 'not accepted', 'declined', 'expired'])
    .or('fin_revenue.is.null,fin_revenue.eq.0')
  if (resasCancelleesIds?.length && !dryRun) {
    await supa.from('ventilation').delete().in('reservation_id', resasCancelleesIds.map((r: { id: string }) => r.id))
  }

  // Charger réservations
  const { data: reservations, error } = await supa.from('reservation').select(`
    *,
    bien (
      id, proprietaire_id,
      provision_ae_ref, forfait_dcb_ref, has_ae,
      taux_commission_override, gestion_loyer, agence, skip_facturation,
      proprietaire!proprietaire_id (id, taux_commission)
    ),
    reservation_fee (*),
    reservation_ajustement (*)
  `)
    .eq('mois_comptable', mois)
    .or('fin_revenue.gt.0,final_status.not.in.("cancelled","not_accepted","not accepted","declined","expired")')

  if (error) throw error

  // Détection prolongations (critère A)
  const resasByBienGuest: Record<string, Resa[]> = {}
  for (const r of (reservations || []) as Resa[]) {
    const key = `${r.bien_id}|${(r.guest_name || '').toLowerCase().trim()}`
    if (!resasByBienGuest[key]) resasByBienGuest[key] = []
    resasByBienGuest[key].push(r)
  }
  for (const group of Object.values(resasByBienGuest)) {
    if (group.length < 2) continue
    for (const r of group) {
      const fees = r.reservation_fee || []
      const cleaningFee = fees.find(f => f.label?.toLowerCase() === 'cleaning fee')?.amount || 0
      const communityFee = fees.find(f => f.label?.toLowerCase() === 'community fee')?.amount || 0
      // Pour les réservations manuelles, le community fee est la commission DCB, pas un frais ménage
      const blocksProlongation = cleaningFee > 0 || ((r as any).platform !== 'manual' && communityFee > 0)
      if (blocksProlongation) continue
      const preceding = group.find(other => other.id !== r.id && (other.departure_date || '').substring(0, 10) === (r.arrival_date || '').substring(0, 10))
      if (preceding) { r.isProlongation = true; r.originalResaId = preceding.id }
    }
  }

  // Injecter agence dans chaque resa pour _calculerLignes
  const resasFiltrees = ((reservations || []) as Resa[]).filter(r => r.bien != null && (r.bien.agence || agence) === agence)

  let total = 0, errors = 0, skipped = 0
  const errorDetails: { code: string; msg: string }[] = []
  // Harnais de non-régression (Étape 3, audit fusion des moteurs 21/08/2026) : en dry_run,
  // collecte les lignes calculées par résa pour comparaison avec api/ventiler.js et avec
  // ce qui est réellement en base — jamais peuplé hors dry_run (poids inutile en prod).
  const lignesParResa: { code: string; lignes: LigneComparable[] | null }[] = []

  for (const resa of resasFiltrees) {
    if (proprietairesVerrouilles.has(resa.bien?.proprietaire_id || '')) { skipped++; continue }
    try {
      const lignesResa = await calculerVentilationResa(resa, agence, supa, dryRun)
      if (dryRun) lignesParResa.push({ code: resa.code, lignes: lignesResa })
      total++
    } catch (err) {
      errorDetails.push({ code: resa.code, msg: (err as Error).message })
      errors++
    }
  }

  // Log
  if (!dryRun) {
    // journal_ops (≠ 'journal' qui n'existe pas — le log échouait silencieusement)
    try {
      await supa.from('journal_ops').insert({
        categorie: 'ventilation', action: 'compute_auto', mois_comptable: mois,
        statut: errors > 0 ? 'warning' : 'ok', source: 'cron',
        message: `Ventilation auto ${mois} : ${total} résa(s)${skipped > 0 ? ', ' + skipped + ' verrouillée(s)' : ''}${errors > 0 ? ', ' + errors + ' erreur(s)' : ''}`,
        meta: { total, skipped, errors, errorDetails },
      })
    } catch { /* logging ne doit jamais faire échouer le recalcul */ }
  }

  return { mois, total, skipped, errors, errorDetails, ...(dryRun ? { lignesParResa } : {}) }
}

// ── Handler principal ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supaUrl = Deno.env.get('SUPABASE_URL')!
  const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const agence = Deno.env.get('AGENCE') || 'dcb'
  const supa = createClient(supaUrl, supaKey)

  let body: { mois?: string; agence?: string; dry_run?: boolean } = {}
  try { body = await req.json() } catch {}

  const dryRun = body.dry_run === true
  const agenceTarget = body.agence || agence

  // Déterminer les mois à traiter
  let moisList: string[] = []

  if (body.mois) {
    moisList = [body.mois]
  } else {
    // Auto : tous les mois ayant des réservations avec revenue (passés ET futurs),
    // hors mois clôturés (cloture_ventil = true)
    const { data: moisAvecResas } = await supa.from('reservation')
      .select('mois_comptable')
      .gt('fin_revenue', 0)
      .not('mois_comptable', 'is', null)
    const moisUniques = [...new Set((moisAvecResas || []).map((r: { mois_comptable: string }) => r.mois_comptable))]

    if (moisUniques.length > 0) {
      const { data: clotures } = await supa.from('cloture_comptable')
        .select('mois').eq('agence', agenceTarget).eq('cloture_ventil', true).in('mois', moisUniques)
      const moisClos = new Set((clotures || []).map((c: { mois: string }) => c.mois))
      moisList = moisUniques.filter(m => !moisClos.has(m)).sort()
    }
  }

  if (moisList.length === 0) {
    return jsonResp({ ok: true, message: 'Aucun mois ouvert à ventiler', resultats: [] })
  }

  const resultats = []
  for (const mois of moisList) {
    try {
      const res = await calculerVentilationMois(mois, agenceTarget, supa, dryRun)
      resultats.push(res)
    } catch (err) {
      await logError({ source: 'edge_ventilation-auto', message: (err as Error).message, stack: (err as Error).stack, context: { mois } })
      resultats.push({ mois, error: (err as Error).message })
    }
  }

  return jsonResp({ ok: true, dry_run: dryRun, agence: agenceTarget, mois_traites: moisList, resultats })
})
